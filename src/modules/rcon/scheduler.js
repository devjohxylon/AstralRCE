import { promises as fs } from "fs";
import path from "path";
import { sendGameCommand, isRconEnabled, getRconStatus } from "./client.js";
import { getAutoMessages, saveAutoMessages } from "../../data/store.js";

const DATA_DIR = process.env.DATA_DIR?.trim()
  || path.join(process.cwd(), ".data");
const SCHEDULE_FILE = path.join(DATA_DIR, "scheduled-commands.json");

let timer = null;

async function readSchedule() {
  try {
    const raw = await fs.readFile(SCHEDULE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { jobs: [] };
  }
}

async function writeSchedule(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SCHEDULE_FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function listScheduledCommands() {
  const data = await readSchedule();
  return data.jobs ?? [];
}

export async function addScheduledCommand({ name, command, intervalMinutes = 60 }) {
  const data = await readSchedule();
  if (!data.jobs) data.jobs = [];
  const job = {
    id: crypto.randomUUID().slice(0, 8),
    name: String(name || "Job").slice(0, 64),
    command: String(command).slice(0, 300),
    intervalMinutes: Math.max(1, Number(intervalMinutes) || 60),
    enabled: true,
    lastRunAt: null,
    lastResult: null,
  };
  data.jobs.push(job);
  await writeSchedule(data);
  return job;
}

export async function removeScheduledCommand(id) {
  const data = await readSchedule();
  const before = (data.jobs ?? []).length;
  data.jobs = (data.jobs ?? []).filter((j) => j.id !== id);
  if (data.jobs.length === before) return { ok: false, error: "Job not found." };
  await writeSchedule(data);
  return { ok: true };
}

export async function toggleScheduledCommand(id, enabled) {
  const data = await readSchedule();
  const job = (data.jobs ?? []).find((j) => j.id === id);
  if (!job) return { ok: false, error: "Job not found." };
  job.enabled = enabled;
  await writeSchedule(data);
  return { ok: true, job };
}

export async function updateScheduledCommand(id, patch) {
  const data = await readSchedule();
  const job = (data.jobs ?? []).find((j) => j.id === id);
  if (!job) return { ok: false, error: "Job not found." };
  if (patch.name != null) job.name = String(patch.name).slice(0, 64);
  if (patch.command != null) job.command = String(patch.command).slice(0, 300);
  if (patch.intervalMinutes != null) {
    job.intervalMinutes = Math.max(1, Number(patch.intervalMinutes) || 60);
  }
  if (patch.enabled != null) job.enabled = Boolean(patch.enabled);
  await writeSchedule(data);
  return { ok: true, job };
}

export async function runScheduledCommandNow(id) {
  const data = await readSchedule();
  const job = (data.jobs ?? []).find((j) => j.id === id);
  if (!job) return { ok: false, error: "Job not found." };
  if (!getRconStatus().connected) return { ok: false, error: "RCON offline." };

  const result = await sendGameCommand(job.command);
  job.lastRunAt = new Date().toISOString();
  job.lastResult = String(result ?? "").slice(0, 500);
  await writeSchedule(data);
  return { ok: true, job, result: job.lastResult };
}

async function tickAutoMessages() {
  if (!isRconEnabled() || !getRconStatus().connected) return;

  const data = await getAutoMessages();
  const now = Date.now();
  let changed = false;

  for (const message of data.messages ?? []) {
    if (!message.enabled) continue;
    const intervalMs = message.intervalMinutes * 60_000;
    const last = message.lastSentAt ? new Date(message.lastSentAt).getTime() : 0;
    if (now - last < intervalMs) continue;

    await sendGameCommand(`say <color=#a0d8ff>${message.text}</color>`).catch(() => {});
    message.lastSentAt = new Date().toISOString();
    changed = true;
  }

  if (changed) await saveAutoMessages(data);
}

async function tickScheduledCommands() {
  if (!isRconEnabled() || !getRconStatus().connected) return;

  const data = await readSchedule();
  const now = Date.now();
  let changed = false;

  for (const job of data.jobs ?? []) {
    if (!job.enabled) continue;
    const intervalMs = job.intervalMinutes * 60_000;
    const last = job.lastRunAt ? new Date(job.lastRunAt).getTime() : 0;
    if (now - last < intervalMs) continue;

    try {
      const result = await sendGameCommand(job.command);
      job.lastResult = String(result ?? "").slice(0, 500);
    } catch (error) {
      job.lastResult = `ERROR: ${error.message}`;
    }
    job.lastRunAt = new Date().toISOString();
    changed = true;
  }

  if (changed) await writeSchedule(data);
}

async function tick() {
  await tickAutoMessages().catch(() => {});
  await tickScheduledCommands().catch(() => {});
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => tick(), 30_000);
  console.log("Scheduler started (auto-messages + scheduled RCON)");
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

// Back-compat aliases
export const startAutoMessages = startScheduler;
export const stopAutoMessages = stopScheduler;

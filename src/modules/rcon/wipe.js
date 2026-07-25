import { config } from "../../config.js";
import { getSettings, saveSettings } from "../../data/store.js";
import { sendToWebsite } from "../../services/website.js";

let lastWipeName = null;
let lastWipeRenameAt = 0;
let wipeTimer = null;
let discordClient = null;

export async function getWipeAt() {
  const settings = await getSettings();
  return settings.wipeAt || config.wipe.at || null;
}

export async function setWipeAt(isoOrNull) {
  const settings = await getSettings();
  if (!isoOrNull) {
    delete settings.wipeAt;
  } else {
    const d = new Date(isoOrNull);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Invalid datetime" };
    settings.wipeAt = d.toISOString();
  }
  await saveSettings(settings);
  return { ok: true, wipeAt: settings.wipeAt || null };
}

export function formatWipeCountdown(wipeAt) {
  if (!wipeAt) return { label: "Wipe TBA", remainingMs: null, past: false };
  const target = new Date(wipeAt).getTime();
  const remainingMs = target - Date.now();
  if (remainingMs <= 0) return { label: "Wiped", remainingMs: 0, past: true };

  const totalMins = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;

  let label = "Wipe ";
  if (days > 0) label += `${days}d ${hours}h`;
  else if (hours > 0) label += `${hours}h ${mins}m`;
  else label += `${mins}m`;

  return { label, remainingMs, past: false };
}

export async function buildWipePayload() {
  const wipeAt = await getWipeAt();
  const countdown = formatWipeCountdown(wipeAt);
  return {
    type: "wipe_status",
    source: "astral",
    wipeAt,
    label: countdown.label,
    remainingMs: countdown.remainingMs,
    past: countdown.past,
    updatedAt: new Date().toISOString(),
  };
}

async function renameWipeChannel(client, force = false) {
  const channelId = config.channels.wipeStatus;
  if (!channelId || !client) return;

  const wipeAt = await getWipeAt();
  const { label } = formatWipeCountdown(wipeAt);
  // Discord channel names max 100; keep short for voice
  const name = label.slice(0, 90);
  if (!force && name === lastWipeName) return;

  const now = Date.now();
  if (!force && now - lastWipeRenameAt < config.rcon.statusUpdateMs) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  await channel.setName(name).catch(() => {});
  lastWipeName = name;
  lastWipeRenameAt = now;
}

export async function syncWipeStatus(client = discordClient, { force = false } = {}) {
  const payload = await buildWipePayload();
  await sendToWebsite(payload).catch(() => {});
  await renameWipeChannel(client, force);
  return payload;
}

export function startWipeScheduler(client) {
  discordClient = client;
  if (wipeTimer) return;
  syncWipeStatus(client, { force: true }).catch(() => {});
  // Voice renames are throttled separately; website push more often
  wipeTimer = setInterval(() => {
    syncWipeStatus(client).catch(() => {});
  }, 60_000);
}

export function stopWipeScheduler() {
  if (wipeTimer) clearInterval(wipeTimer);
  wipeTimer = null;
}

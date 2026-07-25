import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(file, fallback) {
  await ensureDir();
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    return JSON.parse(raw);
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(file, data) {
  await ensureDir();
  await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), "utf8");
}

export async function getCases() {
  return readJson("cases.json", { records: [] });
}

export async function addCase(record) {
  const data = await getCases();
  data.records.unshift(record);
  data.records = data.records.slice(0, 5000);
  await writeJson("cases.json", data);
  return record;
}

export async function getCasesForUser(userId) {
  const data = await getCases();
  return data.records.filter((r) => r.userId === userId);
}

export async function getGiveaways() {
  return readJson("giveaways.json", { active: [] });
}

export async function saveGiveaways(data) {
  await writeJson("giveaways.json", data);
}

export async function getTickets() {
  return readJson("tickets.json", { open: [] });
}

export async function saveTickets(data) {
  await writeJson("tickets.json", data);
}

export async function getSettings() {
  return readJson("settings.json", { raidMode: false, lockedChannelIds: [] });
}

export async function saveSettings(settings) {
  await writeJson("settings.json", settings);
}

export async function getPlayerStats() {
  return readJson("player-stats.json", {
    wipe: new Date().toISOString().slice(0, 10),
    players: {},
  });
}

export async function savePlayerStats(data) {
  await writeJson("player-stats.json", data);
}

export async function getLinks() {
  return readJson("links.json", { byDiscord: {}, byIgn: {}, pending: {} });
}

export async function saveLinks(data) {
  await writeJson("links.json", data);
}

export async function getHomes() {
  return readJson("homes.json", { players: {}, warps: {} });
}

export async function saveHomes(data) {
  await writeJson("homes.json", data);
}

export async function getEconomy() {
  return readJson("economy.json", { balances: {}, shop: [] });
}

export async function saveEconomy(data) {
  await writeJson("economy.json", data);
}

export async function getAutoMessages() {
  return readJson("auto-messages.json", { messages: [] });
}

export async function saveAutoMessages(data) {
  await writeJson("auto-messages.json", data);
}

export async function getBlockedWords() {
  const fromData = await readJson("blocked-words.json", null);
  if (fromData?.words?.length) return fromData.words;

  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "data", "blocked-words.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    return parsed.words ?? [];
  } catch {
    return [];
  }
}

export async function getAccessKeys() {
  return readJson("access-keys.json", { keys: [] });
}

export async function saveAccessKeys(data) {
  await writeJson("access-keys.json", data);
}

export async function getPanelLogs() {
  return readJson("panel-logs.json", { entries: [] });
}

export async function savePanelLogs(data) {
  await writeJson("panel-logs.json", data);
}

export async function getKits() {
  return readJson("kits.json", { kits: {} });
}

export async function saveKits(data) {
  await writeJson("kits.json", data);
}

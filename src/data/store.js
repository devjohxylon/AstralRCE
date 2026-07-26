import { promises as fs } from "fs";
import path from "path";

export const DATA_DIR = process.env.DATA_DIR?.trim()
  || path.join(process.cwd(), ".data");

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

/**
 * Log where data lives and warn hard on Railway if there's no volume.
 * Without a volume, links / kits / stats / keys reset on every deploy.
 */
export async function assertDataPersistence() {
  await ensureDir();
  const markerPath = path.join(DATA_DIR, ".persist-check");
  let previous = null;
  try {
    previous = await fs.readFile(markerPath, "utf8");
  } catch {
    /* first boot */
  }

  const stamp = new Date().toISOString();
  await fs.writeFile(markerPath, stamp, "utf8");

  const links = await getLinks();
  const linkCount = Object.keys(links.byDiscord || {}).length;
  const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
  const volumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || null;
  const dataOnVolume =
    volumeMount &&
    (DATA_DIR === volumeMount || DATA_DIR.startsWith(volumeMount.replace(/\/$/, "") + "/"));

  console.log(`Data directory: ${DATA_DIR} (${linkCount} linked account(s))`);

  if (onRailway && !dataOnVolume) {
    console.error(
      "⚠️  PERSISTENCE WARNING: No Railway volume mounted on the data directory.\n" +
        `   Links, kits, stats, wipe time, and access keys will RESET on every redeploy.\n` +
        `   Fix: Railway → service → Volumes → Add Volume → mount path: ${DATA_DIR}\n` +
        `   Or set DATA_DIR to your volume mount path.`,
    );
  } else if (previous) {
    console.log(`Data persistence OK (last boot marker: ${previous.trim()})`);
  }
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

export async function getAnalytics() {
  return readJson("analytics.json", {
    hourly: {},
    daily: {},
    playerActivity: {},
    weaponStats: {},
    serverPerformance: [],
  });
}

export async function saveAnalytics(data) {
  await writeJson("analytics.json", data);
}

export async function getPlayerProfiles() {
  return readJson("player-profiles.json", { profiles: {} });
}

export async function savePlayerProfiles(data) {
  await writeJson("player-profiles.json", data);
}

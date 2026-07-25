import { getPlayerStats, savePlayerStats } from "../../data/store.js";

let cache = null;
let dirty = false;
const sessions = new Map();

async function load() {
  if (!cache) cache = await getPlayerStats();
  return cache;
}

function blankPlayer() {
  return {
    kills: 0,
    deaths: 0,
    suicides: 0,
    npcKills: 0,
    playtimeMs: 0,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
}

function playerRecord(data, name) {
  if (!data.players[name]) data.players[name] = blankPlayer();
  data.players[name].lastSeen = new Date().toISOString();
  return data.players[name];
}

export async function recordKill({ killer, victim }) {
  const data = await load();

  // Only player-vs-player counts toward K/D; NPCs and world deaths are tracked separately.
  const killerIsPlayer = killer?.type === "Player";
  const victimIsPlayer = victim?.type === "Player";

  if (killerIsPlayer && victimIsPlayer) {
    if (killer.name === victim.name) {
      playerRecord(data, victim.name).suicides += 1;
    } else {
      playerRecord(data, killer.name).kills += 1;
      playerRecord(data, victim.name).deaths += 1;
    }
  } else if (killerIsPlayer && !victimIsPlayer) {
    playerRecord(data, killer.name).npcKills += 1;
  } else if (victimIsPlayer) {
    playerRecord(data, victim.name).deaths += 1;
  }

  dirty = true;
}

export async function recordSuicide(name) {
  const data = await load();
  playerRecord(data, name).suicides += 1;
  dirty = true;
}

export async function startSession(name) {
  const data = await load();
  playerRecord(data, name);
  sessions.set(name, Date.now());
  dirty = true;
}

export async function endSession(name) {
  const started = sessions.get(name);
  if (!started) return;
  sessions.delete(name);

  const data = await load();
  playerRecord(data, name).playtimeMs += Date.now() - started;
  dirty = true;
}

// Credits time for players still online so playtime survives restarts.
async function flushOpenSessions() {
  const now = Date.now();
  const data = await load();
  for (const [name, started] of sessions) {
    playerRecord(data, name).playtimeMs += now - started;
    sessions.set(name, now);
  }
}

export async function flushStats({ force = false } = {}) {
  if (sessions.size) await flushOpenSessions();
  if (!dirty && !force) return;
  await savePlayerStats(cache);
  dirty = false;
}

const CATEGORIES = {
  kills: { label: "Kills", key: (p) => p.kills, suffix: "" },
  deaths: { label: "Deaths", key: (p) => p.deaths, suffix: "" },
  kd: {
    label: "K/D Ratio",
    key: (p) => (p.deaths === 0 ? p.kills : p.kills / p.deaths),
    format: (v) => v.toFixed(2),
    minKills: 5,
  },
  playtime: {
    label: "Playtime",
    key: (p) => p.playtimeMs,
    format: (v) => formatPlaytime(v),
  },
};

export function formatPlaytime(ms) {
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
}

export async function getLeaderboard(category = "kills", limit = 10) {
  const meta = CATEGORIES[category] ?? CATEGORIES.kills;
  const data = await load();
  if (sessions.size) await flushOpenSessions();

  return Object.entries(data.players)
    .filter(([, p]) => !meta.minKills || p.kills >= meta.minKills)
    .map(([name, p]) => ({ name, value: meta.key(p), raw: p }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      name: row.name,
      value: meta.format ? meta.format(row.value) : String(row.value),
      numeric: row.value,
    }));
}

export function leaderboardCategories() {
  return Object.entries(CATEGORIES).map(([id, meta]) => ({ id, label: meta.label }));
}

export async function getPlayerCard(name) {
  const data = await load();
  const key = Object.keys(data.players).find(
    (n) => n.toLowerCase() === name.toLowerCase(),
  );
  if (!key) return null;

  const player = data.players[key];
  const kd = player.deaths === 0 ? player.kills : player.kills / player.deaths;
  return { name: key, ...player, kd: kd.toFixed(2) };
}

export async function resetStats(wipeLabel) {
  cache = { wipe: wipeLabel ?? new Date().toISOString().slice(0, 10), players: {} };
  sessions.clear();
  dirty = true;
  await flushStats({ force: true });
  return cache;
}

export async function statsSummary() {
  const data = await load();
  const players = Object.values(data.players);
  return {
    wipe: data.wipe,
    trackedPlayers: players.length,
    totalKills: players.reduce((sum, p) => sum + p.kills, 0),
  };
}

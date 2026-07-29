import { getOnlinePlayers, isRconEnabled, sendGameCommand } from "./client.js";
import { parsePosition } from "./positions.js";

const positions = new Map(); // ignLower -> { x, y, z, at, ign }
let pollTimer = null;
let polling = false;

const POLL_MS = 5_000;
const STALE_MS = 30_000;

export async function fetchPlayerPosition(ign) {
  const name = String(ign ?? "").trim();
  if (!name) return null;

  // Console / Nitrado commonly accept these
  const commands = [
    `server.printpos "${name}"`,
    `printpos "${name}"`,
  ];

  for (const cmd of commands) {
    try {
      const raw = await sendGameCommand(cmd);
      const pos = parsePosition(raw);
      if (pos) {
        positions.set(name.toLowerCase(), { ...pos, ign: name, at: Date.now() });
        return pos;
      }
      if (raw) {
        console.warn(`printpos no coords for ${name}:`, String(raw).slice(0, 120));
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

async function pollOnce() {
  if (polling || !isRconEnabled()) return;
  polling = true;
  try {
    const online = getOnlinePlayers();
    const onlineKeys = new Set(online.map((p) => p.ign.toLowerCase()));

    for (const key of [...positions.keys()]) {
      if (!onlineKeys.has(key)) positions.delete(key);
    }

    // Sequential to avoid flooding RCON (3s timeout each in rce.js)
    for (const player of online) {
      await fetchPlayerPosition(player.ign).catch(() => null);
    }
  } finally {
    polling = false;
  }
}

export function startPositionPolling() {
  if (pollTimer) return;
  pollOnce().catch(() => {});
  pollTimer = setInterval(() => pollOnce().catch(() => {}), POLL_MS);
  console.log("Live map position polling started");
}

export function stopPositionPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function getCachedPositions() {
  const now = Date.now();
  const out = [];
  for (const entry of positions.values()) {
    if (now - entry.at > STALE_MS) continue;
    out.push({
      ign: entry.ign,
      coords: { x: entry.x, y: entry.y, z: entry.z },
      updatedAt: new Date(entry.at).toISOString(),
    });
  }
  return out;
}

export function getPositionFor(ign) {
  const entry = positions.get(String(ign ?? "").toLowerCase());
  if (!entry || Date.now() - entry.at > STALE_MS) return null;
  return { x: entry.x, y: entry.y, z: entry.z };
}

/** Merge online players with cached coords for websocket / API. */
export function getPlayersWithPositions() {
  const byIgn = new Map(getCachedPositions().map((p) => [p.ign.toLowerCase(), p]));
  return getOnlinePlayers().map((p) => {
    const cached = byIgn.get(p.ign.toLowerCase());
    return {
      ign: p.ign,
      ping: p.ping ?? null,
      platform: p.platform ?? null,
      team: p.team?.id ?? null,
      coords: cached?.coords || null,
      updatedAt: cached?.updatedAt || null,
    };
  });
}

import { RCEManager, LogLevel, RCEEvent, RCEIntent } from "rce.js";
import { config } from "../../config.js";

let manager = null;
let lastError = null;
let connectedAt = null;
let watchdog = null;
let reattaching = false;
let reconnectAttempts = 0;
/** host:port fingerprint — used to drop stale kit caches when RCON target changes */
let activeEndpointKey = null;

const WATCHDOG_MS = 12_000;

export function isRconEnabled() {
  const { enabled, host, port, password } = config.rcon;
  return Boolean(enabled && host && port && password);
}

export function getRconEndpointKey() {
  const { host, port } = config.rcon;
  if (!host || !port) return null;
  return `${String(host).toLowerCase()}:${Number(port)}`;
}

/** Clear in-memory KitManager list so a server switch can't show the previous kit list. */
export function clearServerKitCache() {
  const server = getServer();
  if (server) server.kits = [];
}

function serverOptions() {
  return {
    identifier: config.rcon.identifier,
    rcon: {
      host: config.rcon.host,
      port: config.rcon.port,
      password: config.rcon.password,
    },
    state: [],
    reconnection: { enabled: true, interval: 5000, maxAttempts: -1 },
    intents: [RCEIntent.ServerInfo, RCEIntent.PlayerList, RCEIntent.Teams],
  };
}

function socketIsOpen() {
  const socket = getServer()?.socket;
  // ws readyState: 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
  return Boolean(socket && socket.readyState === 1);
}

export function getRconStatus() {
  const live = socketIsOpen();
  return {
    enabled: isRconEnabled(),
    connected: live,
    lastError: live ? null : lastError,
    connectedAt: live ? connectedAt : null,
    identifier: config.rcon.identifier,
    host: config.rcon.host || null,
    port: config.rcon.port || null,
    endpointKey: getRconEndpointKey(),
  };
}

export function getManager() {
  return manager;
}

export function getServer() {
  return manager?.getServer(config.rcon.identifier) ?? null;
}

export function getServerInfo() {
  return getServer()?.info ?? null;
}

export function getOnlinePlayers() {
  const players = getServer()?.players ?? [];
  return players.filter((p) => p.isOnline !== false);
}

async function attachServer() {
  const added = await manager.addServer(serverOptions()).catch((error) => {
    lastError = error.message;
    return false;
  });

  if (!added) {
    console.error(
      "Could not reach the Rust server. Double-check RCON_HOST / RCON_PORT / RCON_PASSWORD in your Nitrado panel.",
    );
  }
  return Boolean(added);
}

// rce.js gives up permanently if the FIRST websocket attempt fails
// (it only auto-reconnects after a successful connection). This watchdog
// re-attaches the server whenever the socket is down so a bad moment at
// deploy time doesn't leave RCON dead until the next restart.
async function watchdogTick() {
  if (reattaching || socketIsOpen()) return;
  reattaching = true;
  reconnectAttempts += 1;
  try {
    console.warn(`RCON watchdog: connection down — reconnect attempt ${reconnectAttempts}…`);
    if (getServer()) manager.removeServer(config.rcon.identifier);
    const ok = await attachServer();
    if (ok && socketIsOpen()) reconnectAttempts = 0;
  } catch (error) {
    lastError = error.message;
  }
  reattaching = false;
}

export async function connectRcon() {
  if (!isRconEnabled()) {
    console.log("RCON disabled — set RCON_HOST, RCON_PORT, RCON_PASSWORD in .env to connect.");
    return null;
  }

  manager = new RCEManager({ logger: { level: LogLevel.Error } });

  manager.on(RCEEvent.Ready, () => {
    lastError = null;
    connectedAt = new Date();
    reconnectAttempts = 0;
    const key = getRconEndpointKey();
    if (activeEndpointKey && key && activeEndpointKey !== key) {
      clearServerKitCache();
    }
    activeEndpointKey = key;
    clearServerKitCache();
    console.log(`RCON connected to ${config.rcon.host}:${config.rcon.port}`);
  });

  manager.on(RCEEvent.Error, ({ error }) => {
    let msg = typeof error === "string" ? error : String(error?.message ?? error);
    if (/Does Not Exist Or Is Not Connected|Is Not Connected!/i.test(msg)) {
      msg = "Not connected to the game server (websocket down). Reconnecting…";
    }
    lastError = msg;
    console.error("RCON error:", msg);

    // Nitrado often drops the socket with ECONNRESET — kick the watchdog
    // immediately instead of waiting for the next interval tick.
    if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|closed|WebSocket error/i.test(msg)) {
      setTimeout(() => watchdogTick().catch(() => {}), 1500);
    }
  });

  await attachServer();

  if (!watchdog) {
    watchdog = setInterval(() => watchdogTick().catch(() => {}), WATCHDOG_MS);
  }

  return manager;
}

export async function sendGameCommand(command) {
  if (!manager || !socketIsOpen()) {
    throw new Error("RCON is not connected to the game server.");
  }
  // Note: commands with no console output resolve undefined after rce.js's
  // 3s timeout — that's still a successful send, not a failure.
  const response = await manager.sendCommand(config.rcon.identifier, command);
  return response ?? "";
}

export async function fetchServerInfo() {
  if (!manager || !socketIsOpen()) {
    throw new Error("RCON is not connected to the game server.");
  }
  return manager.fetchInfo(config.rcon.identifier);
}

export async function broadcast(message) {
  return sendGameCommand(`say ${message}`);
}

let cachedMapMetadata = null;

function parseMapNumber(raw) {
  if (raw == null) return null;
  const text = String(raw).replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function mapImageCandidates(seed, size) {
  const custom = process.env.RUST_MAP_IMAGE_URL?.trim();
  if (custom) return [custom];
  // Served by /admin/api/map/image after RustMaps / custom download into .data/maps
  if (seed) return [`/admin/api/map/image?seed=${seed}&size=${size || 4000}`];
  return [];
}

export async function getMapMetadata() {
  if (cachedMapMetadata) return cachedMapMetadata;

  const envSeed = process.env.RUST_MAP_SEED ? parseMapNumber(process.env.RUST_MAP_SEED) : null;
  const envSize = process.env.RUST_MAP_SIZE ? parseMapNumber(process.env.RUST_MAP_SIZE) : null;

  if (!manager || !socketIsOpen()) {
    const seed = envSeed;
    const size = envSize || 4000;
    return {
      seed,
      size,
      imageUrl: mapImageCandidates(seed, size)[0] || null,
      imageUrls: mapImageCandidates(seed, size),
    };
  }

  try {
    const seedResponse = await sendGameCommand("global.seed").catch(() =>
      sendGameCommand("seed").catch(() => null),
    );

    const sizeResponse = await sendGameCommand("global.worldsize").catch(() =>
      sendGameCommand("worldsize").catch(() => null),
    );

    const seed = parseMapNumber(seedResponse) || envSeed;
    const size = parseMapNumber(sizeResponse) || envSize || 4000;
    const images = mapImageCandidates(seed, size);

    cachedMapMetadata = {
      seed,
      size,
      imageUrl: images[0] || null,
      imageUrls: images,
    };

    if (cachedMapMetadata.seed) {
      console.log(`Map metadata cached: Seed ${cachedMapMetadata.seed}, Size ${cachedMapMetadata.size}m`);
    }

    return cachedMapMetadata;
  } catch (error) {
    console.error("Failed to fetch map metadata:", error.message);
    const seed = envSeed;
    const size = envSize || 4000;
    return {
      seed,
      size,
      imageUrl: mapImageCandidates(seed, size)[0] || null,
      imageUrls: mapImageCandidates(seed, size),
    };
  }
}

export function clearMapMetadataCache() {
  cachedMapMetadata = null;
}

export function destroyRcon() {
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
  manager?.destroy();
  manager = null;
  connectedAt = null;
  cachedMapMetadata = null;
}

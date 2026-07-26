import { RCEManager, LogLevel, RCEEvent, RCEIntent } from "rce.js";
import { config } from "../../config.js";

let manager = null;
let connected = false;
let lastError = null;
let connectedAt = null;

export function isRconEnabled() {
  const { enabled, host, port, password } = config.rcon;
  return Boolean(enabled && host && port && password);
}

function socketIsOpen() {
  const socket = getServer()?.socket;
  // ws readyState: 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
  return Boolean(socket && socket.readyState === 1);
}

export function getRconStatus() {
  const live = socketIsOpen() || (connected && Boolean(getServer()?.info));
  return {
    enabled: isRconEnabled(),
    connected: live,
    lastError: live ? null : lastError,
    connectedAt,
    identifier: config.rcon.identifier,
    host: config.rcon.host || null,
    port: config.rcon.port || null,
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

function markConnected() {
  const was = connected;
  connected = true;
  lastError = null;
  if (!was || !connectedAt) connectedAt = new Date();
}

function markDisconnected(reason) {
  connected = false;
  if (reason) lastError = reason;
}

export async function connectRcon() {
  if (!isRconEnabled()) {
    console.log("RCON disabled — set RCON_HOST, RCON_PORT, RCON_PASSWORD in .env to connect.");
    return null;
  }

  manager = new RCEManager({ logger: { level: LogLevel.Error } });

  manager.on(RCEEvent.Ready, () => {
    markConnected();
    console.log(`RCON connected to ${config.rcon.host}:${config.rcon.port}`);
  });

  manager.on(RCEEvent.ServerInfoUpdated, () => {
    markConnected();
  });

  manager.on(RCEEvent.Error, ({ error }) => {
    const msg = typeof error === "string" ? error : String(error?.message ?? error);
    lastError = msg;
    console.error("RCON error:", msg);
    // Connection/socket failures → show offline until Ready/info again
    if (/websocket|closed|ECONN|ETIMEDOUT|failed to connect|not connected/i.test(msg)) {
      markDisconnected(msg);
    }
  });

  const added = await manager
    .addServer({
      identifier: config.rcon.identifier,
      rcon: {
        host: config.rcon.host,
        port: config.rcon.port,
        password: config.rcon.password,
      },
      state: [],
      reconnection: { enabled: true, interval: 5000, maxAttempts: -1 },
      intents: [RCEIntent.ServerInfo, RCEIntent.PlayerList, RCEIntent.Teams],
    })
    .catch((error) => {
      lastError = error.message;
      markDisconnected(error.message);
      console.error("RCON connection failed:", error.message);
      return false;
    });

  if (!added) {
    console.error(
      "Could not reach the Rust server. Double-check RCON_HOST / RCON_PORT / RCON_PASSWORD in your Nitrado panel.",
    );
  } else if (socketIsOpen() || getServerInfo()) {
    // addServer resolved successfully — Ready can race; trust live state
    markConnected();
  }

  return manager;
}

export async function sendGameCommand(command) {
  if (!manager) throw new Error("RCON is not connected.");
  try {
    const response = await manager.sendCommand(config.rcon.identifier, command);
    markConnected();
    return response ?? "";
  } catch (error) {
    markDisconnected(error.message);
    throw error;
  }
}

export async function fetchServerInfo() {
  if (!manager) throw new Error("RCON is not connected.");
  const info = await manager.fetchInfo(config.rcon.identifier);
  markConnected();
  return info;
}

export async function broadcast(message) {
  return sendGameCommand(`say ${message}`);
}

export function destroyRcon() {
  manager?.destroy();
  manager = null;
  connected = false;
  connectedAt = null;
}

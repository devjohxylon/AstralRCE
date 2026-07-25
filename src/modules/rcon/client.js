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

export function getRconStatus() {
  return {
    enabled: isRconEnabled(),
    connected,
    lastError,
    connectedAt,
    identifier: config.rcon.identifier,
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

export async function connectRcon() {
  if (!isRconEnabled()) {
    console.log("RCON disabled — set RCON_HOST, RCON_PORT, RCON_PASSWORD in .env to connect.");
    return null;
  }

  manager = new RCEManager({ logger: { level: LogLevel.Error } });

  manager.on(RCEEvent.Ready, () => {
    connected = true;
    lastError = null;
    connectedAt = new Date();
    console.log(`RCON connected to ${config.rcon.host}:${config.rcon.port}`);
  });

  manager.on(RCEEvent.Error, ({ error }) => {
    lastError = typeof error === "string" ? error : String(error);
    console.error("RCON error:", lastError);
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
      console.error("RCON connection failed:", error.message);
      return false;
    });

  if (!added) {
    console.error(
      "Could not reach the Rust server. Double-check RCON_HOST / RCON_PORT / RCON_PASSWORD in your Nitrado panel.",
    );
  }

  return manager;
}

export async function sendGameCommand(command) {
  if (!manager) throw new Error("RCON is not connected.");
  const response = await manager.sendCommand(config.rcon.identifier, command);
  return response ?? "";
}

export async function fetchServerInfo() {
  if (!manager) throw new Error("RCON is not connected.");
  return manager.fetchInfo(config.rcon.identifier);
}

export async function broadcast(message) {
  return sendGameCommand(`say ${message}`);
}

export function destroyRcon() {
  manager?.destroy();
  manager = null;
  connected = false;
}

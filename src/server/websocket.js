import { Server } from "socket.io";
import { getSession } from "../modules/admin/access-keys.js";
import { getOnlinePlayers, getRconStatus, getServerInfo } from "../modules/rcon/client.js";
import { getPlayersWithPositions } from "../modules/rcon/live-map.js";
import { statsSummary } from "../modules/rcon/stats.js";

let io = null;
const connectedSockets = new Map();

export function createWebSocketServer(httpServer) {
  io = new Server(httpServer, {
    path: "/admin/socket.io",
    cors: { origin: "*", credentials: true },
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    const req = socket.request;
    const session = getSession(req);
    if (!session) {
      return next(new Error("Unauthorized"));
    }
    socket.session = session;
    next();
  });

  io.on("connection", (socket) => {
    console.log(`Admin panel WebSocket connected: ${socket.session.label}`);
    connectedSockets.set(socket.id, socket);

    socket.on("disconnect", () => {
      connectedSockets.delete(socket.id);
      console.log(`Admin panel WebSocket disconnected: ${socket.session.label}`);
    });

    socket.emit("connected", { 
      message: "Real-time connection established",
      role: socket.session.role,
    });
  });

  startRealtimeUpdates();
  return io;
}

function startRealtimeUpdates() {
  setInterval(() => {
    if (!io || connectedSockets.size === 0) return;
    
    const rcon = getRconStatus();
    const server = getServerInfo();
    const players = getOnlinePlayers();

    io.emit("server:update", {
      rcon: {
        connected: rcon.connected,
        enabled: rcon.enabled,
      },
      server: server ? {
        players: server.Players,
        maxPlayers: server.MaxPlayers,
        fps: server.Framerate,
        entities: server.EntityCount,
      } : null,
      onlineCount: players.length,
    });

    io.emit("players:update", getPlayersWithPositions());
  }, 3000);

  setInterval(async () => {
    if (!io || connectedSockets.size === 0) return;
    const summary = await statsSummary().catch(() => null);
    if (summary) {
      io.emit("stats:update", summary);
    }
  }, 30000);
}

export function broadcastKillEvent(data) {
  if (!io) return;
  io.emit("kill:new", {
    killer: data.killer?.name || "Unknown",
    victim: data.victim?.name || "Unknown",
    weapon: data.weapon || null,
    distance: data.distance || null,
    headshot: data.headshot || false,
    timestamp: new Date().toISOString(),
  });
}

export function broadcastPlayerJoin(ign) {
  if (!io) return;
  io.emit("player:join", { ign, timestamp: new Date().toISOString() });
}

export function broadcastPlayerLeave(ign) {
  if (!io) return;
  io.emit("player:leave", { ign, timestamp: new Date().toISOString() });
}

export function broadcastRconCommand(command, result, success = true) {
  if (!io) return;
  io.emit("rcon:command", {
    command,
    result,
    success,
    timestamp: new Date().toISOString(),
  });
}

export function broadcastAlert(message, level = "info") {
  if (!io) return;
  io.emit("alert:new", {
    message,
    level,
    timestamp: new Date().toISOString(),
  });
}

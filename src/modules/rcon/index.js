import { RCEEvent } from "rce.js";
import { config } from "../../config.js";
import { sendToWebsite } from "../../services/website.js";
import {
  connectRcon,
  getManager,
  getOnlinePlayers,
  getServerInfo,
  isRconEnabled,
  sendGameCommand,
} from "./client.js";
import {
  attachFeedClient,
  feedItemSpawn,
  feedJoin,
  feedKill,
  feedKitSpawn,
  feedLeave,
  feedPlayerBanned,
  feedPlayerUnbanned,
  feedQuickChat,
  feedRoleChange,
  feedServerEvent,
  flushAllFeeds,
} from "./feeds.js";
import {
  endSession,
  flushStats,
  getLeaderboard,
  recordKill,
  recordSuicide,
  startSession,
} from "./stats.js";
import { startScheduler, stopScheduler } from "./scheduler.js";

const LEADERBOARD_BOARDS = [
  { category: "kills", title: "Top Kills" },
  { category: "kd", title: "Best K/D" },
  { category: "playtime", title: "Most Playtime" },
];

let lastStatusName = null;

export async function startRcon(client) {
  if (!isRconEnabled()) {
    console.log("RCON not configured — running in Discord-only mode.");
    return null;
  }

  attachFeedClient(client);
  const manager = await connectRcon();
  if (!manager) return null;

  manager.on(RCEEvent.PlayerKill, async (data) => {
    feedKill(data);
    await recordKill(data).catch(() => {});

    if (config.rcon.ingameKillfeed && data.killer?.type === "Player") {
      await sendGameCommand(
        `say <color=#ff5555>${data.killer.name}</color> killed <color=#ff5555>${data.victim.name}</color>`,
      ).catch(() => {});
    }
  });

  manager.on(RCEEvent.PlayerJoined, async ({ player }) => {
    feedJoin(player);
    await startSession(player.ign).catch(() => {});
  });

  manager.on(RCEEvent.PlayerLeft, async ({ player }) => {
    feedLeave(player);
    await endSession(player.ign).catch(() => {});
  });

  manager.on(RCEEvent.PlayerSuicide, async ({ player }) => {
    await recordSuicide(player.ign).catch(() => {});
  });

  manager.on(RCEEvent.QuickChat, ({ player, message, type }) => {
    feedQuickChat({ player, message, type });
  });

  manager.on(RCEEvent.EventStart, (data) => {
    feedServerEvent(data).catch(() => {});
  });

  manager.on(RCEEvent.PlayerBanned, feedPlayerBanned);
  manager.on(RCEEvent.PlayerUnbanned, feedPlayerUnbanned);
  manager.on(RCEEvent.ItemSpawn, feedItemSpawn);
  manager.on(RCEEvent.KitSpawn, feedKitSpawn);
  manager.on(RCEEvent.PlayerRoleAdd, (d) => feedRoleChange({ ...d, added: true }));
  manager.on(RCEEvent.PlayerRoleRemove, (d) => feedRoleChange({ ...d, added: false }));

  manager.on(RCEEvent.ServerInfoUpdated, ({ info }) => {
    syncServerStatus(client, info).catch((error) =>
      console.error("Server status sync failed:", error.message),
    );
  });

  setInterval(() => flushStats().catch(() => {}), 60_000);
  setInterval(
    () =>
      pushLeaderboardToWebsite().catch((error) =>
        console.error("Leaderboard push failed:", error.message),
      ),
    config.rcon.leaderboardPushMs,
  );

  startScheduler();
  return manager;
}

// Pushes live player counts to the website and renames the status voice channel.
// Discord throttles channel renames hard, so this is gated by RCON_STATUS_UPDATE_MS.
export async function syncServerStatus(client, info = getServerInfo()) {
  if (!info) return null;

  const payload = {
    type: "server_status",
    source: "rcon",
    players: info.Players ?? 0,
    maxPlayers: info.MaxPlayers ?? config.server.max,
    queued: info.Queued ?? 0,
    joining: info.Joining ?? 0,
    hostname: info.Hostname ?? null,
    map: info.Map ?? null,
    gameTime: info.GameTime ?? null,
    uptimeSeconds: info.Uptime ?? null,
    framerate: info.Framerate ?? null,
    restarting: Boolean(info.Restarting),
    online: true,
  };

  await sendToWebsite(payload);
  await updateStatusChannel(client, info);
  return payload;
}

async function updateStatusChannel(client, info) {
  const channelId = config.channels.popStatus;
  if (!channelId) return;

  const queued = info.Queued ? ` 🕑${info.Queued}` : "";
  const name = `🌐 ${info.Players ?? 0}/${info.MaxPlayers ?? "?"}${queued}`;
  if (name === lastStatusName) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  await channel.setName(name).catch(() => {});
  lastStatusName = name;
}

export async function buildLeaderboardPayload(limit = 10) {
  const boards = [];

  for (const board of LEADERBOARD_BOARDS) {
    const rows = await getLeaderboard(board.category, limit);
    if (!rows.length) continue;

    boards.push({
      category: board.category,
      title: board.title,
      entries: rows.map((row) => ({
        rank: row.rank,
        name: row.name,
        value: row.numeric,
        valueRaw: row.value,
        stat: board.category,
      })),
    });
  }

  return boards;
}

export async function pushLeaderboardToWebsite() {
  const leaderboards = await buildLeaderboardPayload();
  if (!leaderboards.length) return null;

  const payload = {
    type: "leaderboard",
    source: "rcon",
    format: "text",
    parsed: true,
    primaryImageUrl: null,
    images: [],
    leaderboards,
    messageId: `rcon-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };

  await sendToWebsite(payload, config.website.leaderboardUrl || config.website.ingestUrl);
  console.log(`Leaderboard pushed to website (${leaderboards.length} board(s))`);
  return payload;
}

// Relays Discord messages into the game. RCE has no free-text chat, so this
// shows up as a server broadcast rather than a player message.
export async function relayDiscordToGame(message) {
  if (!config.rcon.chatBridge) return false;
  if (!config.channels.gameChat) return false;
  if (message.channelId !== config.channels.gameChat) return false;
  if (message.author.bot) return false;

  const text = message.cleanContent?.trim();
  if (!text) return false;

  const name = message.member?.displayName ?? message.author.username;
  await sendGameCommand(
    `say <color=#7289da>[Discord] ${name}</color>: ${text.slice(0, 180)}`,
  ).catch(() => {});
  return true;
}

export async function shutdownRcon() {
  stopScheduler();
  await flushAllFeeds().catch(() => {});
  await flushStats({ force: true }).catch(() => {});
}

export { getOnlinePlayers, getServerInfo, sendGameCommand };

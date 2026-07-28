import { RCEEvent } from "rce.js";
import { config } from "../../config.js";
import { sendToWebsite } from "../../services/website.js";
import { formatPopChannelName, getStatusSettingsSync } from "../admin/status-settings.js";
import {
  connectRcon,
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
import { startWipeScheduler, stopWipeScheduler, syncWipeStatus } from "./wipe.js";
import { syncVipForDiscord, syncVipOnJoin } from "./vip-sync.js";
import {
  attachReportsClient,
  checkTeamSize,
  recordCombatEvent,
  startGroupScanner,
  stopGroupScanner,
} from "./reports.js";
import { startPositionPolling, stopPositionPolling } from "./live-map.js";

const LEADERBOARD_BOARDS = [
  { category: "kills", title: "Top Kills" },
  { category: "kd", title: "Best K/D" },
  { category: "playtime", title: "Most Playtime" },
];

let lastStatusName = null;
let lastStatusRenameAt = 0;
let discordClient = null;

export async function startRcon(client) {
  if (!isRconEnabled()) {
    console.log("RCON not configured — running in Discord-only mode.");
    startWipeScheduler(client);
    return null;
  }

  discordClient = client;
  attachFeedClient(client);
  attachReportsClient(client);
  const manager = await connectRcon();
  if (!manager) {
    startWipeScheduler(client);
    return null;
  }

  manager.on(RCEEvent.Ready, () => {
    syncServerStatus(client, getServerInfo(), { force: true }).catch(() => {});
    pushLeaderboardToWebsite().catch(() => {});
    syncWipeStatus(client, { force: true }).catch(() => {});
    scanTeamsSoon(manager);
  });

  manager.on(RCEEvent.PlayerKill, async (data) => {
    feedKill(data);
    recordCombatEvent(data);
    await recordKill(data).catch(() => {});

    if (config.rcon.ingameKillfeed && data.killer?.type === "Player") {
      await sendGameCommand(
        `say <color=#ff5555>${data.killer.name}</color> killed <color=#ff5555>${data.victim.name}</color>`,
      ).catch(() => {});
    }
  });

  for (const evt of [RCEEvent.TeamCreated, RCEEvent.TeamJoin]) {
    manager.on(evt, ({ team }) => {
      checkTeamSize(team).catch(() => {});
    });
  }

  manager.on(RCEEvent.TeamLeave, () => {
    // Re-scan shortly so shrunk teams clear and oversized ones still alert
    setTimeout(() => scanTeamsSoon(manager), 2000);
  });

  manager.on(RCEEvent.PlayerJoined, async ({ player }) => {
    feedJoin(player);
    await startSession(player.ign).catch(() => {});

    const linked = await syncVipOnJoin(player.ign).catch(() => null);
    if (linked?.discordId && client) {
      const guild = config.discord.guildId
        ? await client.guilds.fetch(config.discord.guildId).catch(() => null)
        : client.guilds.cache.first();
      const member = await guild?.members.fetch(linked.discordId).catch(() => null);
      if (member) {
        await syncVipForDiscord(linked.discordId, member).catch(() => {});
      }
    }
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
  startWipeScheduler(client);
  startGroupScanner();
  startPositionPolling();
  return manager;
}

function scanTeamsSoon(manager) {
  setTimeout(() => {
    const teams = manager?.getTeams?.(config.rcon.identifier) || [];
    for (const team of teams) checkTeamSize(team).catch(() => {});
  }, 3000);
}

export async function syncServerStatus(client, info = getServerInfo(), { force = false } = {}) {
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

  await sendToWebsite(payload).catch(() => {});
  await updateStatusChannel(client, info, force);
  return payload;
}

async function updateStatusChannel(client, info, force = false) {
  const channelId = config.channels.popStatus;
  if (!channelId || !client) return;

  const popSettings = getStatusSettingsSync().popStatus;
  if (popSettings?.enabled === false) return;

  const name = formatPopChannelName(info, popSettings);
  if (!force && name === lastStatusName) return;

  const now = Date.now();
  if (!force && now - lastStatusRenameAt < config.rcon.statusUpdateMs) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  await channel.setName(name).catch(() => {});
  lastStatusName = name;
  lastStatusRenameAt = now;
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
  stopWipeScheduler();
  stopGroupScanner();
  stopPositionPolling();
  await flushAllFeeds().catch(() => {});
  await flushStats({ force: true }).catch(() => {});
}

export { getOnlinePlayers, getServerInfo, sendGameCommand };

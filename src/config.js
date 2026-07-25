import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function parseChannelId(name) {
  const value = optional(name);
  return value || null;
}

function parseBool(name, fallback = false) {
  const value = optional(name).toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function parseIdList(name) {
  return optional(name)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

const announcements = parseChannelId("CHANNEL_ANNOUNCEMENTS");
const wipes = parseChannelId("CHANNEL_WIPES");
const events = parseChannelId("CHANNEL_EVENTS");
const kaosActivity = parseChannelId("CHANNEL_KAOS_ACTIVITY");
const leaderboard = parseChannelId("CHANNEL_LEADERBOARD");
const pop = parseChannelId("POP_CHANNEL_ID");
const modLog = parseChannelId("CHANNEL_MOD_LOG");
const ticketLog = parseChannelId("CHANNEL_TICKET_LOG") || modLog;
const welcome = parseChannelId("CHANNEL_WELCOME");
const ticketCategory = parseChannelId("CATEGORY_TICKETS");
const staffAlert = parseChannelId("CHANNEL_STAFF_ALERT");

// ——— In-game feed channels (RCON) ———
const killfeed = parseChannelId("CHANNEL_KILLFEED");
const gameChat = parseChannelId("CHANNEL_GAME_CHAT");
const joinLeave = parseChannelId("CHANNEL_JOIN_LEAVE");
const gameEvents = parseChannelId("CHANNEL_GAME_EVENTS");
const adminLog = parseChannelId("CHANNEL_ADMIN_LOG");
const popStatusChannel = parseChannelId("CHANNEL_POP_STATUS");
const tpLog = parseChannelId("CHANNEL_TP_LOG");
const wipeStatus = parseChannelId("CHANNEL_WIPE_STATUS");

function parseWordList(name) {
  return optional(name)
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
}

const ingestUrl = optional("WEBSITE_INGEST_URL") || null;
const leaderboardUrlOverride = optional("WEBSITE_LEADERBOARD_URL");
const websiteApiSecret = optional("WEBSITE_API_SECRET") || null;
const skipWebsiteSync =
  parseBool("SKIP_WEBSITE_SYNC") || !ingestUrl;

if (!ingestUrl) {
  console.warn(
    "WEBSITE_INGEST_URL not set — website sync disabled. Bot will still run Discord + RCON.",
  );
}

const outboundChannels = {
  announcement: announcements,
  wipe: wipes,
  event: events,
};

const watchChannels = new Set(
  [
    kaosActivity,
    leaderboard,
    parseBool("INGEST_ANNOUNCEMENTS") ? announcements : null,
  ].filter(Boolean),
);

function resolveLeaderboardIngestUrl(ingestUrl, leaderboardUrl) {
  if (!leaderboardUrl) return ingestUrl;
  if (!ingestUrl) return leaderboardUrl.includes("/api/") ? leaderboardUrl : null;
  if (leaderboardUrl.includes("/api/")) return leaderboardUrl;
  console.warn(
    `WEBSITE_LEADERBOARD_URL must be an API path (e.g. .../api/discord/ingest), not a public page. Using WEBSITE_INGEST_URL instead.`,
  );
  return ingestUrl;
}

function parseRconEndpoint() {
  let host = optional("RCON_HOST") || null;
  let port = Number(optional("RCON_PORT", "0")) || 0;

  // Allow pasting "85.190.153.190:10800" into RCON_HOST by mistake
  if (host && host.includes(":") && !host.includes("://")) {
    const [maybeHost, maybePort] = host.split(":");
    if (maybeHost && /^\d+$/.test(maybePort)) {
      if (!port) port = Number(maybePort);
      else if (port !== Number(maybePort)) {
        console.warn(
          `RCON_HOST included port ${maybePort} but RCON_PORT is ${port}. Using RCON_HOST port ${maybePort}.`,
        );
        port = Number(maybePort);
      }
      host = maybeHost;
    }
  }

  return { host, port };
}

const rconEndpoint = parseRconEndpoint();

export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    guildId: optional("GUILD_ID"),
  },
  channels: {
    announcements,
    wipes,
    events,
    kaosActivity,
    leaderboard,
    pop,
    modLog,
    ticketLog,
    welcome,
    ticketCategory,
    staffAlert,
    killfeed,
    gameChat,
    joinLeave,
    gameEvents,
    adminLog,
    popStatus: popStatusChannel,
    tpLog,
    wipeStatus,
    outbound: outboundChannels,
    watch: watchChannels,
  },
  roles: {
    staff: parseIdList("ROLE_STAFF_IDS"),
    verified: optional("ROLE_VERIFIED") || null,
    autoMember: optional("ROLE_AUTO_MEMBER") || null,
    muted: optional("ROLE_MUTED") || null,
    vip: optional("ROLE_VIP") || null,
  },
  automod: {
    enabled: parseBool("AUTOMOD_ENABLED", true),
    minAccountDays: Number(optional("MIN_ACCOUNT_DAYS", "0")),
    minJoinHours: Number(optional("MIN_JOIN_HOURS", "0")),
    linkAllowlist: parseWordList("LINK_ALLOWLIST").length
      ? parseWordList("LINK_ALLOWLIST")
      : ["acesrust.com", "tip4serv.com"],
    allowInvites: parseBool("ALLOW_DISCORD_INVITES"),
    wordBlocklist: parseWordList("WORD_FILTER"),
    raidJoinThreshold: Number(optional("RAID_JOIN_THRESHOLD", "8")),
    raidWindowSeconds: Number(optional("RAID_WINDOW_SECONDS", "15")),
  },
  moderation: {
    autoMuteAfterWarns: Number(optional("AUTO_MUTE_AFTER_WARNS", "3")),
    autoMuteMinutes: Number(optional("AUTO_MUTE_MINUTES", "60")),
  },
  giveaways: {
    minAccountDays: Number(optional("GIVEAWAY_MIN_ACCOUNT_DAYS", "1")),
    minJoinHours: Number(optional("GIVEAWAY_MIN_JOIN_HOURS", "1")),
    autoVip: parseBool("GIVEAWAY_AUTO_VIP"),
  },
  server: {
    // Optional fixed slot count, since the KAOS channel name has no max.
    // Set SERVER_MAX in .env (e.g. 100) to show "23/100"; leave unset for "23 online".
    max: Number(optional("SERVER_MAX", "0")) || 0,
    pollMs: Number(optional("POP_POLL_MS", "30000")) || 30000,
  },
  rcon: {
    enabled: parseBool("RCON_ENABLED", Boolean(rconEndpoint.host)),
    host: rconEndpoint.host,
    port: rconEndpoint.port,
    password: optional("RCON_PASSWORD") || null,
    identifier: optional("RCON_SERVER_NAME", "astral"),
    chatBridge: parseBool("RCON_CHAT_BRIDGE"),
    ingameKillfeed: parseBool("RCON_INGAME_KILLFEED"),
    statusUpdateMs: Number(optional("RCON_STATUS_UPDATE_MS", "300000")) || 300000,
    leaderboardPushMs: Number(optional("RCON_LEADERBOARD_PUSH_MS", "600000")) || 600000,
  },
  teleports: {
    enabled: parseBool("TP_ENABLED", true),
    maxHomes: Number(optional("TP_MAX_HOMES", "2")) || 2,
    vipMaxHomes: Number(optional("TP_VIP_MAX_HOMES", "5")) || 5,
    cooldownSeconds: Number(optional("TP_COOLDOWN_SECONDS", "300")) || 300,
    vipCooldownSeconds: Number(optional("TP_VIP_COOLDOWN_SECONDS", "60")) || 60,
    delaySeconds: Number(optional("TP_DELAY_SECONDS", "10")) || 10,
    tprEnabled: parseBool("TP_TPR_ENABLED", true),
    tprTimeoutSeconds: Number(optional("TP_TPR_TIMEOUT_SECONDS", "60")) || 60,
  },
  economy: {
    enabled: parseBool("ECONOMY_ENABLED", true),
    killReward: Number(optional("ECONOMY_KILL_REWARD", "25")) || 25,
    deathPenalty: Number(optional("ECONOMY_DEATH_PENALTY", "5")) || 5,
    playtimeReward: Number(optional("ECONOMY_PLAYTIME_REWARD", "10")) || 10,
    playtimeMinutes: Number(optional("ECONOMY_PLAYTIME_MINUTES", "30")) || 30,
    startingBalance: Number(optional("ECONOMY_STARTING_BALANCE", "100")) || 100,
  },
  ingestAnnouncements: parseBool("INGEST_ANNOUNCEMENTS"),
  leaderboard: {
    minEntries: Number(optional("LEADERBOARD_MIN_ENTRIES", "1")),
    sendRawOnParseFail: parseBool("LEADERBOARD_SEND_RAW"),
  },
  website: {
    ingestUrl,
    leaderboardUrl: resolveLeaderboardIngestUrl(ingestUrl, leaderboardUrlOverride),
    apiSecret: websiteApiSecret,
    skipSync: skipWebsiteSync,
  },
  webhook: {
    secret: optional("BOT_WEBHOOK_SECRET", "change-me-webhook-secret"),
    // Railway/Render set PORT; local dev uses BOT_WEBHOOK_PORT
    port: Number(process.env.PORT || optional("BOT_WEBHOOK_PORT", "3847")),
  },
  adminPanel: {
    password:
      optional("ADMIN_PANEL_PASSWORD") ||
      optional("BOT_WEBHOOK_SECRET") ||
      "change-me",
    // Public URL for logs / bookmarks, e.g. https://admin.astralrce.com
    publicUrl: optional("ADMIN_PANEL_URL") || null,
  },
  brand: {
    // Logo for Discord panels (thumbnail/footer). Falls back to server icon.
    logoUrl: optional("BRAND_LOGO_URL") || null,
  },
  vip: {
    kitId: optional("VIP_KIT_ID", "vip") || "vip",
    grantCommand: optional("VIP_RCON_GRANT") || null,
    revokeCommand: optional("VIP_RCON_REVOKE") || null,
  },
  wipe: {
    // Fallback if settings.json has no wipeAt; ISO string e.g. 2026-08-01T18:00:00Z
    at: optional("WIPE_AT") || null,
  },
  adminUserIds: new Set(parseIdList("ADMIN_USER_IDS")),
};

export function channelTypeForId(channelId) {
  if (channelId === config.channels.announcements) return "announcement";
  if (channelId === config.channels.wipes) return "wipe";
  if (channelId === config.channels.events) return "event";
  if (channelId === config.channels.kaosActivity) return "kaos_activity";
  if (channelId === config.channels.leaderboard) return "leaderboard";
  return "unknown";
}

export function isAdmin(userId) {
  if (config.adminUserIds.size === 0) return true;
  return config.adminUserIds.has(userId);
}

import { config } from "../../config.js";
import { getSettings, saveSettings } from "../../data/store.js";

/** Channels editable from the admin Server Commands tab. */
export const CHANNEL_FIELDS = [
  {
    group: "Feeds",
    key: "killfeed",
    label: "Killfeed",
    env: "CHANNEL_KILLFEED",
    hint: "Player kills / deaths",
  },
  {
    group: "Feeds",
    key: "joinLeave",
    label: "Join / Leave",
    env: "CHANNEL_JOIN_LEAVE",
    hint: "Players joining and leaving",
  },
  {
    group: "Feeds",
    key: "gameChat",
    label: "Game chat",
    env: "CHANNEL_GAME_CHAT",
    hint: "Quick chat + Discord bridge",
  },
  {
    group: "Feeds",
    key: "gameEvents",
    label: "Game events",
    env: "CHANNEL_GAME_EVENTS",
    hint: "Heli, cargo, airdrop, bradley",
  },
  {
    group: "Feeds",
    key: "adminLog",
    label: "Admin log",
    env: "CHANNEL_ADMIN_LOG",
    hint: "VIP grants, bans, kit spawns",
  },
  {
    group: "Feeds",
    key: "reports",
    label: "Reports / combat",
    env: "CHANNEL_REPORTS",
    hint: "Staff combat log + trio group alerts",
  },
  {
    group: "Feeds",
    key: "tpLog",
    label: "Teleport log",
    env: "CHANNEL_TP_LOG",
    hint: "Homes / warps / TPR usage",
  },
  {
    group: "Status",
    key: "popStatus",
    label: "Pop status (rename)",
    env: "CHANNEL_POP_STATUS",
    hint: "Voice/text channel renamed to live pop",
  },
  {
    group: "Status",
    key: "wipeStatus",
    label: "Wipe status (rename)",
    env: "CHANNEL_WIPE_STATUS",
    hint: "Channel renamed to wipe countdown",
  },
  {
    group: "Status",
    key: "pop",
    label: "KAOS pop scrape",
    env: "POP_CHANNEL_ID",
    hint: "Fallback when RCON is off",
  },
  {
    group: "Community",
    key: "modLog",
    label: "Mod log",
    env: "CHANNEL_MOD_LOG",
    hint: "Warns, mutes, bans",
  },
  {
    group: "Community",
    key: "ticketLog",
    label: "Ticket log",
    env: "CHANNEL_TICKET_LOG",
    hint: "Ticket open/close transcripts",
  },
  {
    group: "Community",
    key: "welcome",
    label: "Welcome",
    env: "CHANNEL_WELCOME",
    hint: "New member messages",
  },
  {
    group: "Community",
    key: "staffAlert",
    label: "Staff alert",
    env: "CHANNEL_STAFF_ALERT",
    hint: "Raid / urgent alerts",
  },
  {
    group: "Website",
    key: "leaderboard",
    label: "Leaderboard",
    env: "CHANNEL_LEADERBOARD",
    hint: "Live Astral leaderboard image (also used to relay KAOS if posted here)",
  },
  {
    group: "Website",
    key: "announcements",
    label: "Announcements",
    env: "CHANNEL_ANNOUNCEMENTS",
    hint: "Outbound announcement posts",
  },
  {
    group: "Website",
    key: "wipes",
    label: "Wipes",
    env: "CHANNEL_WIPES",
    hint: "Wipe announcement posts",
  },
  {
    group: "Website",
    key: "events",
    label: "Events",
    env: "CHANNEL_EVENTS",
    hint: "Community event posts",
  },
  {
    group: "Website",
    key: "kaosActivity",
    label: "KAOS activity",
    env: "CHANNEL_KAOS_ACTIVITY",
    hint: "Activity feed relay",
  },
];

const ALLOWED = new Set(CHANNEL_FIELDS.map((f) => f.key));

function normalizeId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d{5,32}$/.test(raw)) return null;
  return raw;
}

/** Apply overrides from settings.json onto the live config object. */
export function applyChannelOverrides(overrides = {}) {
  for (const [key, value] of Object.entries(overrides)) {
    if (!ALLOWED.has(key)) continue;
    config.channels[key] = value || null;
  }

  // Keep outbound / watch sets in sync with mutable channel ids
  config.channels.outbound.announcement = config.channels.announcements;
  config.channels.outbound.wipe = config.channels.wipes;
  config.channels.outbound.event = config.channels.events;

  config.channels.watch.clear();
  for (const id of [
    config.channels.kaosActivity,
    config.channels.leaderboard,
    config.ingestAnnouncements ? config.channels.announcements : null,
  ].filter(Boolean)) {
    config.channels.watch.add(id);
  }
}

export async function loadChannelOverrides() {
  const settings = await getSettings();
  const overrides = settings.channels || {};
  applyChannelOverrides(overrides);
  return overrides;
}

export async function getChannelConfig() {
  const settings = await getSettings();
  const overrides = settings.channels || {};

  return CHANNEL_FIELDS.map((field) => {
    const override = Object.prototype.hasOwnProperty.call(overrides, field.key)
      ? overrides[field.key] || null
      : undefined;
    const effective = config.channels[field.key] || null;
    return {
      ...field,
      value: effective,
      override: override === undefined ? null : override,
      source:
        override !== undefined && override !== null
          ? "panel"
          : effective
            ? "env"
            : "unset",
    };
  });
}

export async function saveChannelConfig(patch = {}) {
  const settings = await getSettings();
  settings.channels = settings.channels || {};

  const errors = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!ALLOWED.has(key)) {
      errors.push(`Unknown channel key: ${key}`);
      continue;
    }
    if (raw === "" || raw == null) {
      delete settings.channels[key];
      // Fall back to env default for that key — reload from process.env via re-read
      // We store explicit null as "cleared override" by deleting; then apply env.
      continue;
    }
    const id = normalizeId(raw);
    if (!id) {
      errors.push(`${key}: must be a Discord channel snowflake id`);
      continue;
    }
    settings.channels[key] = id;
  }

  if (errors.length) return { ok: false, error: errors.join("; ") };

  await saveSettings(settings);

  // Rebuild effective map: start from env defaults already on config, then apply overrides.
  // Env defaults were loaded at boot; for keys we deleted, restore from process.env.
  for (const field of CHANNEL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(settings.channels, field.key)) {
      const envVal = process.env[field.env]?.trim() || null;
      config.channels[field.key] = envVal;
    }
  }
  applyChannelOverrides(settings.channels);

  return { ok: true, channels: await getChannelConfig() };
}

/** Common RCE / console event presets (Rust Console Edition commands). */
export const EVENT_PRESETS = [
  { id: "heli", label: "Call Patrol Heli", command: "events.triggerevent event_helicopter" },
  { id: "bradley", label: "Respawn Bradley", command: "bradley.quickrespawn" },
  { id: "airdrop", label: "Call Airdrop", command: "events.triggerevent event_airdrop" },
  { id: "cargo", label: "Spawn Cargo Ship", command: "events.triggerevent event_cargoship" },
  { id: "chinook", label: "Call Chinook", command: "events.triggerevent event_cargoheli" },
];

/** In-game auth ranks (vanilla RCON). */
export const RANK_PRESETS = [
  {
    id: "owner",
    label: "Owner",
    grant: (ign) => `ownerid "${ign}" "Astral panel"`,
    revoke: (ign) => `removeowner "${ign}"`,
  },
  {
    id: "moderator",
    label: "Moderator",
    grant: (ign) => `moderatorid "${ign}" "Astral panel"`,
    revoke: (ign) => `removemoderator "${ign}"`,
  },
];

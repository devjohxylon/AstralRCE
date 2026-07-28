import { config } from "../../config.js";
import { getSettings, saveSettings } from "../../data/store.js";

/**
 * Catalog of Discord slash commands + optional knobs.
 * `enabled` is always available; extra fields only where the command needs them.
 */
export const COMMAND_SETTING_DEFS = [
  // ——— Rust ———
  {
    group: "Rust",
    key: "server",
    name: "/server",
    description: "Live Rust server info",
    access: "public",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Rust",
    key: "players",
    name: "/players",
    description: "List players currently online",
    access: "public",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Rust",
    key: "stats",
    name: "/stats",
    description: "me · player · panel — wipe stats card",
    access: "public",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Rust",
    key: "leaderboard",
    name: "/leaderboard",
    description: "Show the in-game leaderboard",
    access: "public",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Rust",
    key: "rcon",
    name: "/rcon",
    description: "say · console · kick · ban · unban · give · resetstats · pushstats",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },

  // ——— Player ———
  {
    group: "Player",
    key: "link",
    name: "/link",
    description: "Link Discord ↔ in-game name (start · status · unlink · panel · force)",
    access: "public",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Player",
    key: "home",
    name: "/home",
    description: "Set and teleport to homes",
    access: "public",
    fields: [
      toggle("enabled", "Enabled", true),
      number("maxHomes", "Max homes", config.teleports.maxHomes, {
        hint: "Default players",
        min: 1,
        max: 20,
      }),
      number("vipMaxHomes", "VIP max homes", config.teleports.vipMaxHomes, {
        min: 1,
        max: 50,
      }),
      number("cooldownSeconds", "Cooldown (sec)", config.teleports.cooldownSeconds, {
        min: 0,
        max: 86400,
      }),
      number("vipCooldownSeconds", "VIP cooldown (sec)", config.teleports.vipCooldownSeconds, {
        min: 0,
        max: 86400,
      }),
      number("delaySeconds", "TP delay (sec)", config.teleports.delaySeconds, {
        hint: "Countdown before teleport",
        min: 0,
        max: 120,
      }),
    ],
  },
  {
    group: "Player",
    key: "warp",
    name: "/warp",
    description: "Public warps (go · list · set · delete)",
    access: "public",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Player",
    key: "tpr",
    name: "/tpr",
    description: "Request teleport to another player",
    access: "public",
    fields: [
      toggle("enabled", "Enabled", true),
      number("timeoutSeconds", "Request timeout (sec)", config.teleports.tprTimeoutSeconds, {
        min: 10,
        max: 600,
      }),
    ],
  },
  {
    group: "Player",
    key: "tpa",
    name: "/tpa",
    description: "Accept a teleport request",
    access: "public",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Player",
    key: "tpd",
    name: "/tpd",
    description: "Deny a teleport request",
    access: "public",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Player",
    key: "automessage",
    name: "/automessage",
    description: "Timed in-game broadcasts (add · list · remove · toggle)",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },

  // ——— Website ———
  {
    group: "Website",
    key: "astral-status",
    name: "/astral-status",
    description: "Show Astral bot status",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Website",
    key: "astral-leaderboard",
    name: "/astral-leaderboard",
    description: "Sync KAOS leaderboard to the website",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Website",
    key: "astral-sync",
    name: "/astral-sync",
    description: "Backfill a watched channel to the website",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },

  // ——— Moderation ———
  {
    group: "Moderation",
    key: "warn",
    name: "/warn",
    description: "Warn a member",
    access: "staff",
    fields: [
      toggle("enabled", "Enabled", true),
      number("autoMuteAfterWarns", "Auto-mute after warns", config.moderation.autoMuteAfterWarns, {
        hint: "0 = off",
        min: 0,
        max: 20,
      }),
      number("autoMuteMinutes", "Auto-mute minutes", config.moderation.autoMuteMinutes, {
        min: 1,
        max: 40320,
      }),
    ],
  },
  {
    group: "Moderation",
    key: "mute",
    name: "/mute",
    description: "Timeout a member",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Moderation",
    key: "kick",
    name: "/kick",
    description: "Kick a Discord member",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Moderation",
    key: "ban",
    name: "/ban",
    description: "Ban a Discord member",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Moderation",
    key: "purge",
    name: "/purge",
    description: "Delete recent messages",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Moderation",
    key: "slowmode",
    name: "/slowmode",
    description: "Set channel slowmode",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Moderation",
    key: "lock",
    name: "/lock",
    description: "Lock a channel",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Moderation",
    key: "unlock",
    name: "/unlock",
    description: "Unlock a channel",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Moderation",
    key: "raidmode",
    name: "/raidmode",
    description: "Lock all channels during a raid",
    access: "admin",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Moderation",
    key: "case",
    name: "/case",
    description: "View moderation history",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },

  // ——— Community ———
  {
    group: "Community",
    key: "giveaway",
    name: "/giveaway",
    description: "create · end · reroll",
    access: "staff",
    fields: [
      toggle("enabled", "Enabled", true),
      number("minAccountDays", "Min account age (days)", config.giveaways.minAccountDays, {
        min: 0,
        max: 365,
      }),
      number("minJoinHours", "Min server join (hours)", config.giveaways.minJoinHours, {
        min: 0,
        max: 8760,
      }),
      toggle("autoVip", "Auto VIP for winners", config.giveaways.autoVip),
    ],
  },
  {
    group: "Community",
    key: "ticket",
    name: "/ticket",
    description: "setup · close",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Community",
    key: "poll",
    name: "/poll",
    description: "Quick poll",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
  {
    group: "Community",
    key: "announce",
    name: "/announce",
    description: "Post an announcement embed",
    access: "staff",
    fields: [toggle("enabled", "Enabled", true)],
  },
];

function toggle(key, label, defaultValue, extra = {}) {
  return { key, type: "toggle", label, default: defaultValue, ...extra };
}

function number(key, label, defaultValue, extra = {}) {
  return { key, type: "number", label, default: defaultValue, ...extra };
}

let cache = null;

function defaultsFor(def) {
  const out = {};
  for (const field of def.fields) out[field.key] = field.default;
  return out;
}

export function defaultCommandSettings() {
  const out = {};
  for (const def of COMMAND_SETTING_DEFS) out[def.key] = defaultsFor(def);
  return out;
}

function mergeCommand(def, stored = {}) {
  const merged = defaultsFor(def);
  for (const field of def.fields) {
    if (!Object.prototype.hasOwnProperty.call(stored, field.key)) continue;
    const raw = stored[field.key];
    if (field.type === "toggle") {
      merged[field.key] = Boolean(raw);
    } else if (field.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      let v = Math.trunc(n);
      if (field.min != null) v = Math.max(field.min, v);
      if (field.max != null) v = Math.min(field.max, v);
      merged[field.key] = v;
    } else if (field.type === "text") {
      const s = String(raw ?? "").trim();
      merged[field.key] = s || field.default;
    }
  }
  return merged;
}

export function normalizeCommandSettings(stored = {}) {
  const out = {};
  for (const def of COMMAND_SETTING_DEFS) {
    out[def.key] = mergeCommand(def, stored[def.key] || {});
  }
  return out;
}

/** Push panel overrides onto live config (teleports / giveaways / moderation). */
export function applyCommandOverrides(values = getCommandSettingsSync()) {
  const home = values.home || {};
  const tpr = values.tpr || {};
  const warn = values.warn || {};
  const giveaway = values.giveaway || {};

  const anyTp =
    home.enabled !== false ||
    values.warp?.enabled !== false ||
    tpr.enabled !== false ||
    values.tpa?.enabled !== false ||
    values.tpd?.enabled !== false;

  config.teleports.enabled = anyTp;
  config.teleports.tprEnabled = tpr.enabled !== false;
  if (home.maxHomes != null) config.teleports.maxHomes = home.maxHomes;
  if (home.vipMaxHomes != null) config.teleports.vipMaxHomes = home.vipMaxHomes;
  if (home.cooldownSeconds != null) config.teleports.cooldownSeconds = home.cooldownSeconds;
  if (home.vipCooldownSeconds != null) {
    config.teleports.vipCooldownSeconds = home.vipCooldownSeconds;
  }
  if (home.delaySeconds != null) config.teleports.delaySeconds = home.delaySeconds;
  if (tpr.timeoutSeconds != null) config.teleports.tprTimeoutSeconds = tpr.timeoutSeconds;

  if (warn.autoMuteAfterWarns != null) {
    config.moderation.autoMuteAfterWarns = warn.autoMuteAfterWarns;
  }
  if (warn.autoMuteMinutes != null) {
    config.moderation.autoMuteMinutes = warn.autoMuteMinutes;
  }

  if (giveaway.minAccountDays != null) {
    config.giveaways.minAccountDays = giveaway.minAccountDays;
  }
  if (giveaway.minJoinHours != null) {
    config.giveaways.minJoinHours = giveaway.minJoinHours;
  }
  if (giveaway.autoVip != null) config.giveaways.autoVip = Boolean(giveaway.autoVip);
}

export async function loadCommandSettings() {
  const settings = await getSettings();
  cache = normalizeCommandSettings(settings.commands || {});
  applyCommandOverrides(cache);
  return cache;
}

export async function getCommandSettings() {
  if (!cache) await loadCommandSettings();
  return cache;
}

export function getCommandSettingsSync() {
  return cache || defaultCommandSettings();
}

export function isCommandEnabled(name) {
  const values = getCommandSettingsSync();
  const cmd = values[name];
  if (!cmd) return true;
  return cmd.enabled !== false;
}

export async function getCommandSettingsForPanel() {
  const values = await getCommandSettings();
  const groups = {};
  for (const def of COMMAND_SETTING_DEFS) {
    (groups[def.group] ||= []).push({
      key: def.key,
      name: def.name,
      description: def.description,
      access: def.access,
      fields: def.fields.map((field) => ({
        ...field,
        value: values[def.key][field.key],
      })),
    });
  }
  return {
    commandGroups: Object.entries(groups).map(([group, commands]) => ({
      group,
      commands,
    })),
    commands: values,
  };
}

export async function saveCommandSettings(patch = {}) {
  const settings = await getSettings();
  const current = normalizeCommandSettings(settings.commands || {});

  for (const [cmdKey, cmdPatch] of Object.entries(patch)) {
    const def = COMMAND_SETTING_DEFS.find((d) => d.key === cmdKey);
    if (!def || !cmdPatch || typeof cmdPatch !== "object") continue;
    current[cmdKey] = mergeCommand(def, { ...current[cmdKey], ...cmdPatch });
  }

  settings.commands = current;
  await saveSettings(settings);
  cache = current;
  applyCommandOverrides(cache);
  return { ok: true, ...(await getCommandSettingsForPanel()) };
}

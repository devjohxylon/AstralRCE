import { getSettings, saveSettings } from "../../data/store.js";

/** Live channel rename displays (pop / wipe) — editable on the Discord tab. */
export const STATUS_SETTING_DEFS = [
  {
    key: "popStatus",
    label: "Pop count channel",
    hint: "Renames CHANNEL_POP_STATUS. Avoid “/” — Discord text channels strip it (🌐 12/100 → 🌐-12100).",
    fields: [
      {
        key: "enabled",
        type: "toggle",
        label: "Enabled",
        default: true,
      },
      {
        key: "emoji",
        type: "text",
        label: "Emoji",
        default: "🌐",
        placeholder: "🌐",
      },
      {
        key: "style",
        type: "select",
        label: "Format",
        hint: "How online / max are shown",
        default: "pipe",
        options: [
          { value: "pipe", label: "🌐 12｜100  (recommended)" },
          { value: "dash", label: "🌐 12-100" },
          { value: "of", label: "🌐 12 of 100" },
          { value: "online-only", label: "🌐 12" },
          { value: "custom", label: "Custom template" },
        ],
      },
      {
        key: "template",
        type: "text",
        label: "Custom template",
        hint: "Tokens: {emoji} {online} {max} {queued} {queueEmoji}",
        default: "{emoji} {online}｜{max}",
        placeholder: "{emoji} {online}｜{max}",
      },
      {
        key: "showMax",
        type: "toggle",
        label: "Show max players",
        default: true,
      },
      {
        key: "showQueue",
        type: "toggle",
        label: "Show queue when > 0",
        default: true,
      },
      {
        key: "queueEmoji",
        type: "text",
        label: "Queue emoji",
        default: "🕑",
        placeholder: "🕑",
      },
      {
        key: "offlineLabel",
        type: "text",
        label: "Offline label",
        hint: "Used when RCON has no server info",
        default: "offline",
        placeholder: "offline",
      },
    ],
  },
  {
    key: "wipeStatus",
    label: "Wipe countdown channel",
    hint: "Renames CHANNEL_WIPE_STATUS",
    fields: [
      {
        key: "enabled",
        type: "toggle",
        label: "Enabled",
        default: true,
      },
      {
        key: "prefix",
        type: "text",
        label: "Prefix",
        default: "Wipe",
        placeholder: "Wipe",
      },
      {
        key: "tbaLabel",
        type: "text",
        label: "No wipe set",
        default: "Wipe TBA",
        placeholder: "Wipe TBA",
      },
      {
        key: "wipedLabel",
        type: "text",
        label: "Wipe passed",
        default: "Wiped",
        placeholder: "Wiped",
      },
    ],
  },
];

let cache = null;

function defaultsFor(def) {
  const out = {};
  for (const field of def.fields) out[field.key] = field.default;
  return out;
}

export function defaultStatusSettings() {
  const out = {};
  for (const def of STATUS_SETTING_DEFS) out[def.key] = defaultsFor(def);
  return out;
}

function mergeStatus(def, stored = {}) {
  const merged = defaultsFor(def);
  for (const field of def.fields) {
    if (!Object.prototype.hasOwnProperty.call(stored, field.key)) continue;
    const raw = stored[field.key];
    if (field.type === "toggle") {
      merged[field.key] = Boolean(raw);
    } else if (field.type === "select") {
      const ok = field.options.some((o) => o.value === raw);
      if (ok) merged[field.key] = raw;
    } else if (field.type === "text") {
      const s = String(raw ?? "").trim();
      merged[field.key] = s || field.default;
    } else if (field.type === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) merged[field.key] = Math.trunc(n);
    }
  }
  return merged;
}

export function normalizeStatusSettings(stored = {}) {
  const out = {};
  for (const def of STATUS_SETTING_DEFS) {
    out[def.key] = mergeStatus(def, stored[def.key] || {});
  }
  return out;
}

export async function loadStatusSettings() {
  const settings = await getSettings();
  cache = normalizeStatusSettings(settings.statusDisplays || {});
  return cache;
}

export async function getStatusSettings() {
  if (!cache) await loadStatusSettings();
  return cache;
}

export function getStatusSettingsSync() {
  return cache || defaultStatusSettings();
}

export async function getStatusSettingsForPanel() {
  const values = await getStatusSettings();
  return {
    statusDisplays: STATUS_SETTING_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      hint: def.hint,
      fields: def.fields.map((field) => ({
        ...field,
        value: values[def.key][field.key],
      })),
    })),
    statusValues: values,
  };
}

export async function saveStatusSettings(patch = {}) {
  const settings = await getSettings();
  const current = normalizeStatusSettings(settings.statusDisplays || {});

  for (const [key, valuePatch] of Object.entries(patch)) {
    const def = STATUS_SETTING_DEFS.find((d) => d.key === key);
    if (!def || !valuePatch || typeof valuePatch !== "object") continue;
    current[key] = mergeStatus(def, { ...current[key], ...valuePatch });
  }

  settings.statusDisplays = current;
  await saveSettings(settings);
  cache = current;
  return { ok: true, ...(await getStatusSettingsForPanel()) };
}

function clampCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/** Discord text channels strip "/" and turn spaces into "-". Never emit "/". */
export function sanitizeStatusChannelName(raw) {
  return String(raw ?? "")
    .replace(/\//g, "｜")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function applyTemplate(template, vars) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => {
    if (vars[key] == null) return "";
    return String(vars[key]);
  });
}

/**
 * Build the pop status channel name from server info + panel settings.
 * @param {object|null} info RCON server info
 */
export function formatPopChannelName(info, settings = getStatusSettingsSync().popStatus) {
  const s = settings || defaultStatusSettings().popStatus;
  const emoji = s.emoji || "🌐";
  const queueEmoji = s.queueEmoji || "🕑";

  if (!info) {
    return sanitizeStatusChannelName(`${emoji} ${s.offlineLabel || "offline"}`);
  }

  const online = clampCount(info.Players);
  const maxRaw = Number(info.MaxPlayers);
  const max =
    Number.isFinite(maxRaw) && maxRaw > 0 ? Math.trunc(maxRaw) : null;
  const queued = clampCount(info.Queued);
  const maxLabel = max != null ? String(max) : "?";

  let core;
  switch (s.style) {
    case "online-only":
      core = `${emoji} ${online}`;
      break;
    case "dash":
      core =
        s.showMax !== false
          ? `${emoji} ${online}-${maxLabel}`
          : `${emoji} ${online}`;
      break;
    case "of":
      core =
        s.showMax !== false
          ? `${emoji} ${online} of ${maxLabel}`
          : `${emoji} ${online}`;
      break;
    case "custom":
      core = applyTemplate(s.template || "{emoji} {online}｜{max}", {
        emoji,
        online,
        max: maxLabel,
        queued,
        queueEmoji,
      });
      break;
    case "pipe":
    default:
      core =
        s.showMax !== false
          ? `${emoji} ${online}｜${maxLabel}`
          : `${emoji} ${online}`;
      break;
  }

  if (s.showQueue !== false && queued > 0 && s.style !== "custom") {
    core += ` ${queueEmoji}${queued}`;
  } else if (s.style === "custom" && s.showQueue !== false && queued > 0 && !/\{queued\}/.test(s.template || "")) {
    core += ` ${queueEmoji}${queued}`;
  }

  return sanitizeStatusChannelName(core);
}

export function formatWipeChannelName(wipeAt, settings = getStatusSettingsSync().wipeStatus) {
  const s = settings || defaultStatusSettings().wipeStatus;
  if (!wipeAt) {
    return sanitizeStatusChannelName(s.tbaLabel || "Wipe TBA");
  }

  const target = new Date(wipeAt).getTime();
  const remainingMs = target - Date.now();
  if (remainingMs <= 0) {
    return sanitizeStatusChannelName(s.wipedLabel || "Wiped");
  }

  const totalMins = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  const prefix = (s.prefix || "Wipe").trim() || "Wipe";

  let rest;
  if (days > 0) rest = `${days}d ${hours}h`;
  else if (hours > 0) rest = `${hours}h ${mins}m`;
  else rest = `${mins}m`;

  return sanitizeStatusChannelName(`${prefix} ${rest}`);
}

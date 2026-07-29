import { getSettings, saveSettings } from "../../data/store.js";

/** Live channel rename displays (pop / wipe) — editable on the Discord tab. */
export const STATUS_SETTING_DEFS = [
  {
    key: "popStatus",
    label: "Pop count channel",
    hint: "Renames CHANNEL_POP_STATUS. Text channels strip “|” and spaces → use fullwidth ｜ with no spaces (shows as 9｜100).",
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
        label: "Emoji (optional)",
        default: "",
        placeholder: "(none)",
      },
      {
        key: "style",
        type: "select",
        label: "Format",
        hint: "How online / max are shown",
        default: "pipe",
        options: [
          { value: "pipe", label: "9｜100  (recommended)" },
          { value: "dash", label: "9-100" },
          { value: "of", label: "9-of-100" },
          { value: "online-only", label: "9" },
          { value: "custom", label: "Custom template" },
        ],
      },
      {
        key: "template",
        type: "text",
        label: "Custom template",
        hint: "Tokens: {emoji} {online} {max} {queued} {queueLabel}. No spaces — Discord turns them into -",
        default: "{online}｜{max}",
        placeholder: "{online}｜{max}",
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
        key: "queueLabel",
        type: "text",
        label: "Queue label",
        hint: "Appended as “｜2Que”",
        default: "Que",
        placeholder: "Que",
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
      // Allow intentionally blank (e.g. no pop emoji). Empty default stays empty.
      if (raw == null) continue;
      const s = String(raw).trim();
      merged[field.key] = s.length || field.default === "" ? s : field.default;
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
    const raw = { ...(stored[def.key] || {}) };
    // Drop old globe default so renames become "9 | 100" without a panel visit.
    if (def.key === "popStatus" && raw.emoji === "🌐") raw.emoji = "";
    // queueEmoji → queueLabel migration
    if (def.key === "popStatus" && raw.queueLabel == null && raw.queueEmoji != null) {
      raw.queueLabel = "Que";
      delete raw.queueEmoji;
    }
    out[def.key] = mergeStatus(def, raw);
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

/** Discord text channels strip "/" and "|", and turn spaces into "-". */
export function sanitizeStatusChannelName(raw) {
  return String(raw ?? "")
    .replace(/\//g, "｜")
    .replace(/\|/g, "｜")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function applyTemplate(template, vars) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => {
    if (vars[key] == null) return "";
    return String(vars[key]);
  });
}

function withOptionalEmoji(emoji, rest) {
  const e = String(emoji ?? "").trim();
  return e ? `${e}-${rest}` : rest;
}

function queueSuffix(queued, label) {
  const qLabel = String(label || "Que").trim().replace(/\s+/g, "") || "Que";
  return `｜${queued}${qLabel}`;
}

/**
 * Build the pop status channel name from server info + panel settings.
 * Default: "9｜100" / with queue "9｜100｜2Que"
 * (ASCII "9 | 100" becomes "9--100" on Discord text channels.)
 */
export function formatPopChannelName(info, settings = getStatusSettingsSync().popStatus) {
  const s = settings || defaultStatusSettings().popStatus;
  const emoji = String(s.emoji ?? "").trim();
  const qLabel = s.queueLabel || "Que";

  if (!info) {
    return sanitizeStatusChannelName(
      withOptionalEmoji(emoji, s.offlineLabel || "offline"),
    );
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
      core = withOptionalEmoji(emoji, String(online));
      break;
    case "dash":
      core = withOptionalEmoji(
        emoji,
        s.showMax !== false ? `${online}-${maxLabel}` : String(online),
      );
      break;
    case "of":
      core = withOptionalEmoji(
        emoji,
        s.showMax !== false ? `${online}-of-${maxLabel}` : String(online),
      );
      break;
    case "custom":
      core = applyTemplate(s.template || "{online}｜{max}", {
        emoji,
        online,
        max: maxLabel,
        queued,
        queueLabel: qLabel,
        queueEmoji: qLabel,
      });
      break;
    case "pipe":
    default:
      core = withOptionalEmoji(
        emoji,
        s.showMax !== false ? `${online}｜${maxLabel}` : String(online),
      );
      break;
  }

  if (s.showQueue !== false && queued > 0) {
    if (s.style === "custom" && /\{queued\}/.test(s.template || "")) {
      /* template already includes queue */
    } else {
      core += queueSuffix(queued, qLabel);
    }
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

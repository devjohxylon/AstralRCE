import { config } from "../../config.js";
import { getSettings, saveSettings } from "../../data/store.js";

function envDefault(key, fallback = "") {
  const v = process.env[key]?.trim();
  return v || fallback;
}

function envBool(key, fallback) {
  const v = process.env[key]?.trim()?.toLowerCase();
  if (v == null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v);
}

function envNumber(key, fallback) {
  const n = Number(process.env[key]?.trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** VIP knobs editable from the admin panel. Env values are boot defaults only. */
export const VIP_SETTING_FIELDS = [
  {
    key: "roleId",
    type: "role",
    label: "Discord VIP role",
    hint: "Members with this role can claim the VIP kit in-game",
    env: "ROLE_VIP",
    default: () => envDefault("ROLE_VIP") || "",
  },
  {
    key: "kitId",
    type: "text",
    label: "VIP kit ID",
    hint: "Panel or server kit given on claim / grant",
    placeholder: "vipkit",
    env: "VIP_KIT_ID",
    default: () => envDefault("VIP_KIT_ID", "vipkit") || "vipkit",
  },
  {
    key: "claimEnabled",
    type: "toggle",
    label: "Claim via quick chat",
    hint: "Players claim with the phrase below (requires VIP role + linked IGN)",
    env: "VIP_CLAIM_ENABLED",
    default: () => envBool("VIP_CLAIM_ENABLED", true),
  },
  {
    key: "claimPhrase",
    type: "text",
    label: "Claim phrase",
    hint: 'In-game quick chat text. Use | for aliases, e.g. "i need water|need water"',
    placeholder: "i need water",
    env: "VIP_CLAIM_PHRASE",
    default: () => envDefault("VIP_CLAIM_PHRASE", "i need water") || "i need water",
  },
  {
    key: "claimCooldownSeconds",
    type: "number",
    label: "Claim cooldown (sec)",
    hint: "3600 = 1 hour between claims per player",
    min: 0,
    max: 604800,
    env: "VIP_CLAIM_COOLDOWN_SECONDS",
    default: () => envNumber("VIP_CLAIM_COOLDOWN_SECONDS", 3600),
  },
  {
    key: "autoGrant",
    type: "toggle",
    label: "Auto-grant on role / join / link",
    hint: "Legacy: give kit immediately when Discord VIP is detected (usually leave off)",
    env: "VIP_AUTO_GRANT",
    default: () => envBool("VIP_AUTO_GRANT", false),
  },
  {
    key: "grantCommand",
    type: "text",
    label: "Custom grant RCON",
    hint: "Optional. Use {ign} — if set, runs instead of giving the kit",
    placeholder: 'kit give "{ign}" vipkit',
    env: "VIP_RCON_GRANT",
    default: () => envDefault("VIP_RCON_GRANT") || "",
    optional: true,
  },
  {
    key: "revokeCommand",
    type: "text",
    label: "Custom revoke RCON",
    hint: "Optional. Use {ign} — needed for panel Rank → Revoke VIP",
    placeholder: "",
    env: "VIP_RCON_REVOKE",
    default: () => envDefault("VIP_RCON_REVOKE") || "",
    optional: true,
  },
];

let cache = null;

function resolveDefault(field) {
  return typeof field.default === "function" ? field.default() : field.default;
}

export function defaultVipSettings() {
  const out = {};
  for (const field of VIP_SETTING_FIELDS) out[field.key] = resolveDefault(field);
  return out;
}

function mergeVip(stored = {}) {
  const merged = defaultVipSettings();
  for (const field of VIP_SETTING_FIELDS) {
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
    } else if (field.type === "text" || field.type === "role") {
      const s = String(raw ?? "").trim();
      if (field.optional) {
        merged[field.key] = s;
      } else {
        merged[field.key] = s || resolveDefault(field);
      }
    }
  }
  return merged;
}

export function normalizeVipSettings(stored = {}) {
  return mergeVip(stored);
}

/** Push panel VIP settings onto live config. */
export function applyVipOverrides(values = getVipSettingsSync()) {
  config.vip.kitId = values.kitId || "vipkit";
  config.vip.claimEnabled = Boolean(values.claimEnabled);
  config.vip.claimPhrase = values.claimPhrase || "i need water";
  config.vip.claimCooldownSeconds = Number(values.claimCooldownSeconds) || 0;
  config.vip.autoGrant = Boolean(values.autoGrant);
  config.vip.grantCommand = values.grantCommand?.trim() || null;
  config.vip.revokeCommand = values.revokeCommand?.trim() || null;

  const roleId = String(values.roleId || "").trim();
  config.roles.vip = /^\d{5,32}$/.test(roleId) ? roleId : null;
}

export async function loadVipSettings() {
  const settings = await getSettings();
  cache = normalizeVipSettings(settings.vip || {});
  applyVipOverrides(cache);
  return cache;
}

export async function getVipSettings() {
  if (!cache) await loadVipSettings();
  return cache;
}

export function getVipSettingsSync() {
  return cache || defaultVipSettings();
}

export async function getVipSettingsForPanel() {
  const values = await getVipSettings();
  return {
    vip: {
      fields: VIP_SETTING_FIELDS.map((field) => ({
        key: field.key,
        type: field.type === "role" ? "text" : field.type,
        label: field.label,
        hint: field.hint,
        placeholder: field.placeholder || "",
        min: field.min,
        max: field.max,
        env: field.env,
        value: values[field.key],
      })),
      values,
    },
  };
}

export async function saveVipSettings(patch = {}) {
  const settings = await getSettings();
  const current = normalizeVipSettings({
    ...(settings.vip || {}),
    ...(patch && typeof patch === "object" ? patch : {}),
  });

  settings.vip = current;
  await saveSettings(settings);
  cache = current;
  applyVipOverrides(cache);
  return { ok: true, ...(await getVipSettingsForPanel()) };
}

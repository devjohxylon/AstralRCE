import { getSettings, saveSettings } from "../../data/store.js";

/** Per-feed options shown on the Discord tab. Only feeds that need knobs get extras. */
export const FEED_SETTING_DEFS = [
  {
    key: "killfeed",
    label: "Killfeed",
    hint: "Compact PvP lines in CHANNEL_KILLFEED",
    fields: [
      {
        key: "enabled",
        type: "toggle",
        label: "Enabled",
        hint: "Master switch for Discord kill posts",
        default: true,
      },
      {
        key: "style",
        type: "select",
        label: "Style",
        hint: "Compact embed: Killer killed Victim · Xm",
        default: "compact",
        options: [
          { value: "compact", label: "Compact (Killer killed Victim · Xm)" },
          { value: "classic", label: "Classic (gun text lines)" },
        ],
      },
      {
        key: "showDistance",
        type: "toggle",
        label: "Show distance",
        hint: "Uses live positions when the kill event has no range",
        default: true,
      },
      {
        key: "showNpc",
        type: "toggle",
        label: "Show NPC kills",
        hint: "Scientists, Bradley, etc.",
        default: false,
      },
      {
        key: "showAnimals",
        type: "toggle",
        label: "Show animal kills",
        hint: "Bears, wolves, boars, etc.",
        default: false,
      },
      {
        key: "showEntities",
        type: "toggle",
        label: "Show traps / turrets",
        hint: "Auto turrets, shotgun traps, walls",
        default: false,
      },
      {
        key: "showNatural",
        type: "toggle",
        label: "Show natural deaths",
        hint: "Fall, cold, drown, radiation, hunger",
        default: false,
      },
      {
        key: "showSuicides",
        type: "toggle",
        label: "Show suicides",
        hint: "Player killed themselves",
        default: false,
      },
      {
        key: "showStreaks",
        type: "toggle",
        label: "Show kill streaks",
        hint: "Append 🔥 3/5/10… streak on the kill that hits the milestone",
        default: true,
      },
    ],
  },
  {
    key: "joinLeave",
    label: "Join / Leave",
    hint: "Player connect and disconnect lines",
    fields: [
      {
        key: "enabled",
        type: "toggle",
        label: "Enabled",
        default: true,
      },
    ],
  },
  {
    key: "gameChat",
    label: "Game chat",
    hint: "Quick chat bridge",
    fields: [
      {
        key: "enabled",
        type: "toggle",
        label: "Enabled",
        default: true,
      },
    ],
  },
  {
    key: "gameEvents",
    label: "Game events",
    hint: "Heli, cargo, airdrop embeds",
    fields: [
      {
        key: "enabled",
        type: "toggle",
        label: "Enabled",
        default: true,
      },
    ],
  },
  {
    key: "adminLog",
    label: "Admin log",
    hint: "Bans, kits, role changes",
    fields: [
      {
        key: "enabled",
        type: "toggle",
        label: "Enabled",
        default: true,
      },
    ],
  },
];

const ANIMAL_RE =
  /\b(bear|wolf|boar|chicken|stag|horse|shark|crocodile|panther|deer|polarbear|tiger|snake|ridablehorse|simpleshark)\b/i;

let cache = null;

function defaultsFor(def) {
  const out = {};
  for (const field of def.fields) out[field.key] = field.default;
  return out;
}

export function defaultFeedSettings() {
  const out = {};
  for (const def of FEED_SETTING_DEFS) out[def.key] = defaultsFor(def);
  return out;
}

function mergeFeed(def, stored = {}) {
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
    }
  }
  return merged;
}

export function normalizeFeedSettings(stored = {}) {
  const out = {};
  for (const def of FEED_SETTING_DEFS) {
    out[def.key] = mergeFeed(def, stored[def.key] || {});
  }
  return out;
}

export async function loadFeedSettings() {
  const settings = await getSettings();
  cache = normalizeFeedSettings(settings.feeds || {});
  return cache;
}

export async function getFeedSettings() {
  if (!cache) await loadFeedSettings();
  return cache;
}

/** Sync snapshot for hot path (feeds). Falls back to defaults if not loaded yet. */
export function getFeedSettingsSync() {
  return cache || defaultFeedSettings();
}

export async function getFeedSettingsForPanel() {
  const values = await getFeedSettings();
  return {
    feeds: FEED_SETTING_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      hint: def.hint,
      fields: def.fields.map((field) => ({
        ...field,
        value: values[def.key][field.key],
      })),
    })),
    values,
  };
}

export async function saveFeedSettings(patch = {}) {
  const settings = await getSettings();
  const current = normalizeFeedSettings(settings.feeds || {});

  for (const [feedKey, feedPatch] of Object.entries(patch)) {
    const def = FEED_SETTING_DEFS.find((d) => d.key === feedKey);
    if (!def || !feedPatch || typeof feedPatch !== "object") continue;
    current[feedKey] = mergeFeed(def, { ...current[feedKey], ...feedPatch });
  }

  settings.feeds = current;
  await saveSettings(settings);
  cache = current;
  return { ok: true, ...(await getFeedSettingsForPanel()) };
}

export function isAnimalKillActor(actor) {
  if (!actor) return false;
  if (actor.type !== "Npc") return false;
  return ANIMAL_RE.test(String(actor.name || "")) || ANIMAL_RE.test(String(actor.id || ""));
}

/** Decide whether a kill event should post to Discord given killfeed settings. */
export function shouldPostKill(data, kf = getFeedSettingsSync().killfeed) {
  if (!kf?.enabled) return false;

  const killer = data?.killer ?? data;
  const victim = data?.victim;
  const pvp = killer?.type === "Player" && victim?.type === "Player";
  const suicide = pvp && killer?.name === victim?.name;

  if (suicide) return Boolean(kf.showSuicides);

  if (pvp) return true;

  const involved = [killer, victim].filter(Boolean);
  const hasAnimal = involved.some(isAnimalKillActor);
  const hasNpc = involved.some(
    (a) => a.type === "Npc" && !isAnimalKillActor(a),
  );
  const hasEntity = involved.some((a) => a.type === "Entity");
  const hasNatural = involved.some((a) => a.type === "Natural");

  if (hasAnimal && !kf.showAnimals) return false;
  if (hasNpc && !kf.showNpc) return false;
  if (hasEntity && !kf.showEntities) return false;
  if (hasNatural && !kf.showNatural) return false;

  // Unknown / leftover non-PvP
  if (!hasAnimal && !hasNpc && !hasEntity && !hasNatural) return false;

  return true;
}

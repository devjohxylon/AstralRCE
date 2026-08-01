import { EmbedBuilder } from "discord.js";
import { config } from "../../config.js";
import { getManager } from "./client.js";
import {
  COMBAT_LOG_MAX,
  getCombatLog,
  getSettings,
  saveCombatLog,
  saveSettings,
} from "../../data/store.js";
import { getPositionFor } from "./live-map.js";

const COMBAT_MAX = Math.min(500, COMBAT_LOG_MAX || 500);
const GROUP_MAX_DEFAULT = 3;
const GROUP_COOLDOWN_MS = 10 * 60_000; // don't spam same team
const COMBAT_PERSIST_MS = 1500;

const combatLog = [];
const groupAlerts = [];
const recentGroupAlerts = new Map(); // teamId -> timestamp

let discordClient = null;
let scanTimer = null;
let combatPersistTimer = null;
let combatDirty = false;

export function attachReportsClient(client) {
  discordClient = client;
}

function reportsChannel() {
  return config.channels.reports || config.channels.adminLog || null;
}

export function getGroupMax() {
  return Math.max(1, Number(config.groups?.maxMembers) || GROUP_MAX_DEFAULT);
}

function memberNames(team) {
  const members = Array.isArray(team?.members) ? team.members : [];
  const names = members.map((m) => m?.ign || m?.name).filter(Boolean);
  const leader = team?.leader?.ign || team?.leader?.name;
  if (leader && !names.some((n) => n.toLowerCase() === leader.toLowerCase())) {
    names.unshift(leader);
  }
  return [...new Set(names)];
}

async function persistCombatLog() {
  if (!combatDirty) return;
  combatDirty = false;
  await saveCombatLog({ entries: combatLog.slice(0, COMBAT_MAX) });
}

function scheduleCombatPersist() {
  combatDirty = true;
  if (combatPersistTimer) return;
  combatPersistTimer = setTimeout(() => {
    combatPersistTimer = null;
    persistCombatLog().catch((err) =>
      console.error("Combat log persist failed:", err.message),
    );
  }, COMBAT_PERSIST_MS);
}

function pushCombat(entry) {
  combatLog.unshift(entry);
  if (combatLog.length > COMBAT_MAX) combatLog.length = COMBAT_MAX;
  scheduleCombatPersist();
}

export async function loadPersistedCombatLog() {
  const data = await getCombatLog();
  const rows = Array.isArray(data.entries) ? data.entries : [];
  for (const row of rows.reverse()) {
    if (!row?.id) continue;
    if (!combatLog.some((c) => c.id === row.id)) combatLog.unshift(row);
  }
  if (combatLog.length > COMBAT_MAX) combatLog.length = COMBAT_MAX;
}

function pushGroup(entry) {
  groupAlerts.unshift(entry);
  if (groupAlerts.length > 100) groupAlerts.length = 100;
}

function combatDistance(data, killer, victim) {
  const raw = data?.distance ?? data?.Distance ?? data?.dist ?? data?.meters ?? null;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  const a = getPositionFor(killer?.name);
  const b = getPositionFor(victim?.name);
  if (!a || !b) return null;
  const dx = Number(a.x) - Number(b.x);
  const dz = Number(a.z) - Number(b.z);
  if (![dx, dz].every(Number.isFinite)) return null;
  return Math.round(Math.sqrt(dx * dx + dz * dz));
}

/** Record a kill into the staff combat log (+ optional Discord reports channel). */
export function recordCombatEvent(data) {
  const killer = data?.killer;
  const victim = data?.victim;
  if (!killer || !victim) return null;

  const weapon =
    data?.weapon || data?.Weapon || killer?.weapon || data?.item || null;
  const bodyPart = data?.bodyPart || data?.BodyPart || data?.hitBone || null;
  const headshot = Boolean(data?.headshot) || /head/i.test(String(bodyPart ?? ""));
  const pvp = killer.type === "Player" && victim.type === "Player";
  const distance = combatDistance(data, killer, victim);

  const entry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    type: "combat",
    killer: killer.name,
    killerType: killer.type,
    victim: victim.name,
    victimType: victim.type,
    weapon: weapon || null,
    headshot,
    distance,
    pvp,
  };
  pushCombat(entry);

  // Combat stays in the Reports panel — Discord reports channel is reserved
  // for group-limit alerts so it doesn't drown in kill spam.
  return entry;
}

async function postGroupDiscord(entry) {
  const channelId = reportsChannel();
  if (!channelId || !discordClient) return;

  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`Group limit exceeded (${entry.size}/${entry.max})`)
    .setDescription(
      `Team **#${entry.teamId}** has **${entry.size}** members (max **${entry.max}** for trio).`,
    )
    .addFields({
      name: "Members",
      value: entry.members.map((n) => `• ${n}`).join("\n").slice(0, 1000) || "—",
    })
    .setTimestamp(new Date(entry.at))
    .setFooter({ text: "Astral group detection" });

  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

/**
 * Check a team against the trio (or configured) limit.
 * Dedupes alerts per team for GROUP_COOLDOWN_MS.
 */
export async function checkTeamSize(team, { force = false } = {}) {
  const max = getGroupMax();
  const members = memberNames(team);
  const size = members.length;
  if (size <= max) return null;

  const teamId = Number(team?.id) || 0;
  const last = recentGroupAlerts.get(teamId) || 0;
  if (!force && Date.now() - last < GROUP_COOLDOWN_MS) return null;
  recentGroupAlerts.set(teamId, Date.now());

  const entry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    type: "group",
    teamId,
    size,
    max,
    members,
    leader: team?.leader?.ign || team?.leader?.name || members[0] || null,
  };
  pushGroup(entry);
  await persistGroupAlert(entry).catch(() => {});
  await postGroupDiscord(entry).catch(() => {});
  return entry;
}

async function persistGroupAlert(entry) {
  const settings = await getSettings();
  settings.groupAlerts = settings.groupAlerts || [];
  settings.groupAlerts.unshift(entry);
  settings.groupAlerts = settings.groupAlerts.slice(0, 50);
  await saveSettings(settings);
}

export async function loadPersistedGroupAlerts() {
  const settings = await getSettings();
  const rows = Array.isArray(settings.groupAlerts) ? settings.groupAlerts : [];
  for (const row of rows.reverse()) {
    if (!groupAlerts.some((g) => g.id === row.id)) groupAlerts.unshift(row);
  }
}

/** Clear alert cooldowns (and optionally history) for a fresh wipe. */
export async function clearGroupAlertState({ clearHistory = false } = {}) {
  recentGroupAlerts.clear();
  if (clearHistory) {
    groupAlerts.length = 0;
    const settings = await getSettings();
    settings.groupAlerts = [];
    await saveSettings(settings);
  }
}

/** Scan all known teams from rce.js cache. */
export async function scanAllTeams() {
  const manager = getManager();
  if (!manager) return [];
  const teams = manager.getTeams?.(config.rcon.identifier) || [];
  const hits = [];
  for (const team of teams) {
    const hit = await checkTeamSize(team);
    if (hit) hits.push(hit);
  }
  return hits;
}

export function startGroupScanner() {
  if (scanTimer) return;
  loadPersistedGroupAlerts().catch(() => {});
  loadPersistedCombatLog().catch(() => {});
  scanTimer = setInterval(() => {
    scanAllTeams().catch(() => {});
  }, 90_000);
}

export function stopGroupScanner() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

export function listReports({ limit = 80 } = {}) {
  const n = Math.min(200, Math.max(1, Number(limit) || 80));
  return {
    groupMax: getGroupMax(),
    combat: combatLog.slice(0, n),
    groups: groupAlerts.slice(0, n),
  };
}

export function searchCombat(ign, limit = 40) {
  const q = String(ign ?? "").trim().toLowerCase();
  if (!q) return [];
  return combatLog
    .filter(
      (e) =>
        String(e.killer).toLowerCase().includes(q) ||
        String(e.victim).toLowerCase().includes(q),
    )
    .slice(0, limit);
}

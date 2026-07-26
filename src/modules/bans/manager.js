import { getBans, saveBans } from "../../data/store.js";
import { listPanelLogs } from "../admin/access-keys.js";
import { logAction } from "../audit/logger.js";

let cache = null;
let dirty = false;

async function load() {
  if (!cache) {
    cache = await getBans();
    if (!cache.bans) cache.bans = [];
  }
  return cache;
}

async function persist() {
  if (!dirty || !cache) return;
  await saveBans(cache);
  dirty = false;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

setInterval(() => persist().catch(() => {}), 30000);

/** Create or keep an active ban record (idempotent by IGN). */
export async function upsertActiveBan({
  ign,
  reason = "Banned",
  admin = "System",
  duration = null,
  steamId = null,
  bannedAt = null,
  source = "panel",
} = {}) {
  const name = String(ign ?? "").trim();
  if (!name) return { ok: false, error: "Missing IGN" };

  const data = await load();
  const existing = data.bans.find(
    (b) => b.ign.toLowerCase() === name.toLowerCase() && b.active,
  );
  if (existing) {
    if (reason && reason !== "Banned" && (!existing.reason || existing.reason === "Banned")) {
      existing.reason = reason;
      dirty = true;
      await persist();
    }
    if (steamId && !existing.steamId) {
      existing.steamId = steamId;
      dirty = true;
      await persist();
    }
    return { ok: true, ban: existing, created: false };
  }

  const ban = {
    id: newId(),
    ign: name,
    steamId: steamId || null,
    reason: reason || "Banned",
    admin: admin || "System",
    bannedAt: bannedAt || new Date().toISOString(),
    expiresAt: duration ? new Date(Date.now() + Number(duration)).toISOString() : null,
    active: true,
    source,
    unbannedBy: null,
    unbannedAt: null,
    unbanReason: null,
  };

  data.bans.unshift(ban);
  dirty = true;
  await persist();
  return { ok: true, ban, created: true };
}

export async function banPlayer(ign, reason, admin, duration = null, steamId = null) {
  const result = await upsertActiveBan({
    ign,
    reason,
    admin,
    duration,
    steamId,
    source: "panel",
  });

  if (!result.ok) return result;
  if (!result.created) {
    return { ok: false, error: "Player is already banned", ban: result.ban };
  }

  await logAction("ban_player", {
    admin,
    target: ign,
    extra: { reason, duration: duration ? `${duration}ms` : "permanent" },
  });

  return { ok: true, ban: result.ban };
}

export async function unbanPlayer(ign, admin, reason = "Unbanned") {
  const data = await load();

  const ban = data.bans.find(
    (b) => b.ign.toLowerCase() === String(ign).toLowerCase() && b.active,
  );
  if (!ban) {
    return { ok: false, error: "Player is not banned" };
  }

  ban.active = false;
  ban.unbannedBy = admin;
  ban.unbannedAt = new Date().toISOString();
  ban.unbanReason = reason;

  dirty = true;
  await persist();

  await logAction("unban_player", {
    admin,
    target: ign,
    extra: { reason },
  });

  return { ok: true, ban };
}

export async function isPlayerBanned(ign) {
  const data = await load();
  const now = Date.now();

  const ban = data.bans.find((b) => {
    if (!b.active) return false;
    if (b.ign.toLowerCase() !== String(ign).toLowerCase()) return false;

    if (b.expiresAt) {
      const expiry = new Date(b.expiresAt).getTime();
      if (now >= expiry) {
        b.active = false;
        dirty = true;
        return false;
      }
    }

    return true;
  });

  return ban || null;
}

export async function getBanHistory(ign) {
  const data = await load();
  return data.bans.filter((b) => b.ign.toLowerCase() === String(ign).toLowerCase());
}

export async function getAllActiveBans() {
  const data = await load();
  const now = Date.now();

  return data.bans.filter((b) => {
    if (!b.active) return false;

    if (b.expiresAt) {
      const expiry = new Date(b.expiresAt).getTime();
      if (now >= expiry) {
        b.active = false;
        dirty = true;
        return false;
      }
    }

    return true;
  });
}

export async function getAllBans({ includeInactive = true, limit = 200 } = {}) {
  const data = await load();
  const rows = includeInactive ? [...data.bans] : await getAllActiveBans();
  return rows.slice(0, Math.min(Number(limit) || 200, 500));
}

/**
 * Parse banlistex / banlist RCON output into { ign, steamId, reason } rows.
 * Formats seen:
 *   1 7656119... "Name" "reason"
 *   7656119... "Name" "reason"
 *   Name was banned
 */
export function parseBanlistOutput(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return [];

  const rows = [];
  const seen = new Set();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^banned users/i.test(trimmed) || /^id\b/i.test(trimmed)) continue;

    let match =
      trimmed.match(
        /^(?:\d+\s+)?(\d{15,20})\s+"([^"]+)"\s*(?:"([^"]*)")?/,
      ) ||
      trimmed.match(/^(?:\d+\s+)?(\d{15,20})\s+(\S+)\s*(?:"([^"]*)")?/) ||
      trimmed.match(/^"([^"]+)"\s*(?:"([^"]*)")?/) ||
      trimmed.match(/^(\S+)\s+(?:was )?banned(?:\s*[-:]\s*(.+))?$/i);

    if (!match) continue;

    let steamId = null;
    let ign = null;
    let reason = "Banned";

    if (match[1] && /^\d{15,20}$/.test(match[1])) {
      steamId = match[1];
      ign = match[2];
      reason = match[3] || "Banned";
    } else if (match[1] && !/^\d{15,20}$/.test(match[1])) {
      ign = match[1];
      reason = match[2] || "Banned";
    }

    ign = String(ign || "").replace(/^"|"$/g, "").trim();
    if (!ign || ign.length < 2) continue;
    const key = ign.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      ign,
      steamId,
      reason: String(reason || "Banned").trim() || "Banned",
    });
  }

  return rows;
}

export async function syncBansFromServer(rawBanlist) {
  const parsed = parseBanlistOutput(rawBanlist);
  let added = 0;
  for (const row of parsed) {
    const result = await upsertActiveBan({
      ign: row.ign,
      reason: row.reason,
      admin: "Server banlist",
      steamId: row.steamId,
      source: "server",
    });
    if (result.created) added++;
  }
  return { ok: true, parsed: parsed.length, added, bans: parsed };
}

/** Recover bans that were only written to panel audit logs (pre-store path). */
export async function backfillBansFromPanelLogs() {
  const logs = await listPanelLogs(1000);
  let added = 0;

  for (const entry of logs) {
    if (entry.action !== "ban") continue;
    const ign = entry.detail?.ign;
    if (!ign) continue;

    const result = await upsertActiveBan({
      ign,
      reason: entry.detail?.reason || "Banned",
      admin: entry.by || "panel",
      bannedAt: entry.at || null,
      source: "panel_log",
    });
    if (result.created) added++;
  }

  // Unban markers from logs — only if we have a matching active ban
  for (const entry of logs) {
    if (entry.action !== "unban") continue;
    const ign = entry.detail?.ign;
    if (!ign) continue;
    const active = await isPlayerBanned(ign);
    if (!active) continue;
    // Don't auto-unban from old logs — those may be historical
  }

  return { ok: true, added };
}

export async function cleanExpiredBans() {
  const data = await load();
  const now = Date.now();
  let cleaned = 0;

  for (const ban of data.bans) {
    if (ban.active && ban.expiresAt) {
      const expiry = new Date(ban.expiresAt).getTime();
      if (now >= expiry) {
        ban.active = false;
        dirty = true;
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    await persist();
  }

  return cleaned;
}

setInterval(() => cleanExpiredBans().catch(() => {}), 60000);

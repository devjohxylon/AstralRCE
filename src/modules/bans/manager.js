import { getBans, saveBans } from "../../data/store.js";
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

setInterval(() => persist().catch(() => {}), 30000);

export async function banPlayer(ign, reason, admin, duration = null, steamId = null) {
  const data = await load();
  
  const existing = data.bans.find(b => b.ign.toLowerCase() === ign.toLowerCase() && b.active);
  if (existing) {
    return { ok: false, error: "Player is already banned" };
  }
  
  const ban = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    ign,
    steamId: steamId || null,
    reason,
    admin,
    bannedAt: new Date().toISOString(),
    expiresAt: duration ? new Date(Date.now() + duration).toISOString() : null,
    active: true,
    unbannedBy: null,
    unbannedAt: null,
    unbanReason: null,
  };
  
  data.bans.unshift(ban);
  dirty = true;
  
  await logAction("ban_player", {
    admin,
    target: ign,
    extra: { reason, duration: duration ? `${duration}ms` : "permanent" },
  });
  
  return { ok: true, ban };
}

export async function unbanPlayer(ign, admin, reason = "Unbanned") {
  const data = await load();
  
  const ban = data.bans.find(b => b.ign.toLowerCase() === ign.toLowerCase() && b.active);
  if (!ban) {
    return { ok: false, error: "Player is not banned" };
  }
  
  ban.active = false;
  ban.unbannedBy = admin;
  ban.unbannedAt = new Date().toISOString();
  ban.unbanReason = reason;
  
  dirty = true;
  
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
  
  const ban = data.bans.find(b => {
    if (!b.active) return false;
    if (b.ign.toLowerCase() !== ign.toLowerCase()) return false;
    
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
  return data.bans.filter(b => b.ign.toLowerCase() === ign.toLowerCase());
}

export async function getAllActiveBans() {
  const data = await load();
  const now = Date.now();
  
  return data.bans.filter(b => {
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

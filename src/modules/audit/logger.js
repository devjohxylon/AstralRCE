import { getAuditLog, saveAuditLog } from "../../data/store.js";

let cache = null;
let dirty = false;

async function load() {
  if (!cache) {
    cache = await getAuditLog();
    if (!cache.entries) cache.entries = [];
  }
  return cache;
}

async function persist() {
  if (!dirty || !cache) return;
  await saveAuditLog(cache);
  dirty = false;
}

setInterval(() => persist().catch(() => {}), 30000);

const UNDOABLE = new Set(["ban_player", "unban_player"]);

export async function logAction(action, details = {}) {
  const data = await load();
  
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    timestamp: new Date().toISOString(),
    action,
    admin: details.admin || "System",
    target: details.target || null,
    details: details.extra || null,
    ip: details.ip || null,
    undoable: Boolean(details.undoable ?? UNDOABLE.has(action)),
    undoneAt: null,
    undoneBy: null,
  };
  
  data.entries.unshift(entry);
  
  data.entries = data.entries.slice(0, 10000);
  
  dirty = true;
  return entry;
}

export async function getAuditEntry(id) {
  const data = await load();
  return data.entries.find((e) => e.id === id) || null;
}

export async function markAuditUndone(id, by) {
  const data = await load();
  const entry = data.entries.find((e) => e.id === id);
  if (!entry) return { ok: false, error: "Audit entry not found" };
  if (!entry.undoable) return { ok: false, error: "This action cannot be undone" };
  if (entry.undoneAt) return { ok: false, error: "Already undone" };
  entry.undoneAt = new Date().toISOString();
  entry.undoneBy = by || "staff";
  dirty = true;
  await persist();
  return { ok: true, entry };
}

export async function getAuditEntries(filters = {}) {
  const data = await load();
  let entries = [...data.entries];
  
  if (filters.admin) {
    entries = entries.filter(e => 
      e.admin.toLowerCase().includes(filters.admin.toLowerCase())
    );
  }
  
  if (filters.action) {
    entries = entries.filter(e => 
      e.action.toLowerCase().includes(filters.action.toLowerCase())
    );
  }
  
  if (filters.target) {
    entries = entries.filter(e => 
      e.target && e.target.toLowerCase().includes(filters.target.toLowerCase())
    );
  }
  
  if (filters.startDate) {
    entries = entries.filter(e => new Date(e.timestamp) >= new Date(filters.startDate));
  }
  
  if (filters.endDate) {
    entries = entries.filter(e => new Date(e.timestamp) <= new Date(filters.endDate));
  }
  
  return entries.slice(0, filters.limit || 100);
}

export async function clearOldEntries(daysToKeep = 90) {
  const data = await load();
  const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
  
  const before = data.entries.length;
  data.entries = data.entries.filter(e => new Date(e.timestamp).getTime() > cutoff);
  
  if (before !== data.entries.length) {
    dirty = true;
    await persist();
  }
  
  return before - data.entries.length;
}

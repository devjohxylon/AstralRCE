import { getPlayerProfiles, savePlayerProfiles } from "../../data/store.js";
import { getPlayerCard } from "../rcon/stats.js";
import { getPlayerActivityData } from "../analytics/tracker.js";

let cache = null;
let dirty = false;

async function load() {
  if (!cache) {
    cache = await getPlayerProfiles();
    if (!cache.profiles) cache.profiles = {};
  }
  return cache;
}

async function persist() {
  if (!dirty || !cache) return;
  await savePlayerProfiles(cache);
  dirty = false;
}

setInterval(() => persist().catch(() => {}), 45000);

export async function getPlayerProfile(ign) {
  const data = await load();
  const key = ign.toLowerCase();
  
  const stats = await getPlayerCard(ign).catch(() => null);
  const activity = await getPlayerActivityData(ign).catch(() => null);
  
  const profile = data.profiles[key] || {
    ign,
    notes: [],
    tags: [],
    warnings: [],
    createdAt: new Date().toISOString(),
  };

  return {
    ...profile,
    stats,
    activity,
  };
}

export async function addPlayerNote(ign, note, author) {
  const data = await load();
  const key = ign.toLowerCase();
  
  if (!data.profiles[key]) {
    data.profiles[key] = {
      ign,
      notes: [],
      tags: [],
      warnings: [],
      createdAt: new Date().toISOString(),
    };
  }
  
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    text: note,
    author,
    timestamp: new Date().toISOString(),
  };
  
  data.profiles[key].notes.push(entry);
  dirty = true;
  await persist();
  
  return entry;
}

export async function removePlayerNote(ign, noteId) {
  const data = await load();
  const key = ign.toLowerCase();
  
  if (!data.profiles[key]) return { ok: false, error: "Profile not found" };
  
  const before = data.profiles[key].notes.length;
  data.profiles[key].notes = data.profiles[key].notes.filter(n => n.id !== noteId);
  
  if (before === data.profiles[key].notes.length) {
    return { ok: false, error: "Note not found" };
  }
  
  dirty = true;
  await persist();
  return { ok: true };
}

export async function addPlayerTag(ign, tag) {
  const data = await load();
  const key = ign.toLowerCase();
  
  if (!data.profiles[key]) {
    data.profiles[key] = {
      ign,
      notes: [],
      tags: [],
      warnings: [],
      createdAt: new Date().toISOString(),
    };
  }
  
  const normalized = tag.toLowerCase();
  if (!data.profiles[key].tags.includes(normalized)) {
    data.profiles[key].tags.push(normalized);
    dirty = true;
    await persist();
  }
  
  return { ok: true, tags: data.profiles[key].tags };
}

export async function removePlayerTag(ign, tag) {
  const data = await load();
  const key = ign.toLowerCase();
  
  if (!data.profiles[key]) return { ok: false, error: "Profile not found" };
  
  const normalized = tag.toLowerCase();
  data.profiles[key].tags = data.profiles[key].tags.filter(t => t !== normalized);
  
  dirty = true;
  await persist();
  return { ok: true, tags: data.profiles[key].tags };
}

export async function addPlayerWarning(ign, reason, author) {
  const data = await load();
  const key = ign.toLowerCase();
  
  if (!data.profiles[key]) {
    data.profiles[key] = {
      ign,
      notes: [],
      tags: [],
      warnings: [],
      createdAt: new Date().toISOString(),
    };
  }
  
  const warning = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    reason,
    author,
    timestamp: new Date().toISOString(),
  };
  
  data.profiles[key].warnings.push(warning);
  dirty = true;
  await persist();
  
  return warning;
}

export async function searchPlayers(query) {
  const data = await load();
  const q = query.toLowerCase();
  
  return Object.values(data.profiles)
    .filter(p => 
      p.ign.toLowerCase().includes(q) ||
      p.tags.some(t => t.includes(q)) ||
      p.notes.some(n => n.text.toLowerCase().includes(q))
    )
    .map(p => ({
      ign: p.ign,
      tags: p.tags,
      noteCount: p.notes.length,
      warningCount: p.warnings.length,
    }));
}

export async function listAllProfiles() {
  const data = await load();
  return Object.values(data.profiles).map(p => ({
    ign: p.ign,
    tags: p.tags,
    noteCount: p.notes.length,
    warningCount: p.warnings.length,
    createdAt: p.createdAt,
  }));
}

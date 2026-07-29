import { getAnalytics, saveAnalytics } from "../../data/store.js";

let cache = null;
let dirty = false;

async function load() {
  if (!cache) {
    cache = await getAnalytics();
    if (!cache.hourly) cache.hourly = {};
    if (!cache.daily) cache.daily = {};
    if (!cache.playerActivity) cache.playerActivity = {};
    if (!cache.weaponStats) cache.weaponStats = {};
    if (!cache.serverPerformance) cache.serverPerformance = [];
  }
  return cache;
}

async function persist() {
  if (!dirty || !cache) return;
  await saveAnalytics(cache);
  dirty = false;
}

setInterval(() => persist().catch(() => {}), 60000);

function getHourKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}`;
}

function getDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function trackPlayerCount(count) {
  const data = await load();
  const hour = getHourKey();
  const day = getDayKey();
  
  if (!data.hourly[hour]) data.hourly[hour] = { samples: [], peak: 0 };
  data.hourly[hour].samples.push({ t: Date.now(), v: count });
  data.hourly[hour].peak = Math.max(data.hourly[hour].peak, count);

  if (!data.daily[day]) data.daily[day] = { peak: 0, totalMinutes: 0 };
  data.daily[day].peak = Math.max(data.daily[day].peak, count);

  cleanOldData(data);
  dirty = true;
}

export async function trackPlayerActivity(ign, action) {
  const data = await load();
  const day = getDayKey();
  
  if (!data.playerActivity[ign]) {
    data.playerActivity[ign] = {
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      daysActive: [],
      totalKills: 0,
      totalDeaths: 0,
    };
  }
  
  data.playerActivity[ign].lastSeen = new Date().toISOString();
  
  if (!data.playerActivity[ign].daysActive.includes(day)) {
    data.playerActivity[ign].daysActive.push(day);
  }

  if (action === "kill") data.playerActivity[ign].totalKills += 1;
  if (action === "death") data.playerActivity[ign].totalDeaths += 1;

  dirty = true;
}

export async function trackWeaponKill(weapon) {
  const data = await load();
  const normalized = (weapon || "unknown").toLowerCase();
  
  if (!data.weaponStats[normalized]) {
    data.weaponStats[normalized] = { kills: 0, name: weapon || "Unknown" };
  }
  
  data.weaponStats[normalized].kills += 1;
  dirty = true;
}

export async function trackServerPerformance(fps, entities, players) {
  const data = await load();
  const sample = {
    timestamp: Date.now(),
    fps: fps ?? null,
    entities: entities ?? null,
    players: players ?? null,
  };
  
  data.serverPerformance.push(sample);
  
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  data.serverPerformance = data.serverPerformance.filter(s => s.timestamp > oneHourAgo);
  
  dirty = true;
}

function cleanOldData(data) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const cutoffDay = new Date(sevenDaysAgo);
  const cutoffKey = `${cutoffDay.getFullYear()}-${String(cutoffDay.getMonth() + 1).padStart(2, "0")}-${String(cutoffDay.getDate()).padStart(2, "0")}`;

  for (const key of Object.keys(data.hourly)) {
    if (key < cutoffKey) delete data.hourly[key];
  }
  
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const ign of Object.keys(data.playerActivity)) {
    const lastSeen = new Date(data.playerActivity[ign].lastSeen).getTime();
    if (lastSeen < thirtyDaysAgo) {
      delete data.playerActivity[ign];
    }
  }
}

export async function getAnalyticsSummary() {
  const data = await load();
  
  const hourKeys = Object.keys(data.hourly).sort();
  const last24Hours = hourKeys.slice(-24);
  
  const playerCounts = last24Hours.flatMap(k => 
    (data.hourly[k].samples || []).map(s => s.v)
  );
  
  const peakToday = Math.max(...playerCounts, 0);
  const avgToday = playerCounts.length > 0 
    ? Math.round(playerCounts.reduce((a, b) => a + b, 0) / playerCounts.length)
    : 0;

  const topWeapons = Object.entries(data.weaponStats)
    .sort((a, b) => b[1].kills - a[1].kills)
    .slice(0, 10)
    .map(([id, stat]) => ({ weapon: stat.name, kills: stat.kills }));

  const recentPerf = data.serverPerformance.slice(-60);
  const avgFps = recentPerf.length > 0
    ? Math.round(recentPerf.reduce((sum, s) => sum + (s.fps || 0), 0) / recentPerf.length)
    : null;

  const activePlayerCount = Object.keys(data.playerActivity).length;

  return {
    peak24h: peakToday,
    avg24h: avgToday,
    topWeapons,
    avgFps,
    activePlayers: activePlayerCount,
    hourlyData: last24Hours.map(k => ({
      hour: k,
      peak: data.hourly[k].peak,
      samples: data.hourly[k].samples.length,
    })),
    performanceData: recentPerf,
  };
}

export async function getPlayerActivityData(ign) {
  const data = await load();
  return data.playerActivity[ign.toLowerCase()] || null;
}

/** Clear weapon kill counters for a new wipe (keeps pop/FPS history). */
export async function resetWipeAnalytics() {
  const data = await load();
  data.weaponStats = {};
  dirty = true;
  await persist();
  return { ok: true };
}

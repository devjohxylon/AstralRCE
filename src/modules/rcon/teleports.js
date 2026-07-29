import { config } from "../../config.js";
import { getHomes, saveHomes } from "../../data/store.js";
import { sendGameCommand } from "./client.js";
import { findOnlinePlayer, getLinkByIgn, requireLinkedIgn } from "./linking.js";
import { queueFeedLine } from "./feeds.js";

const cooldowns = new Map();
const pendingTpr = new Map();
const pendingTeleports = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasVip(member) {
  const vipRole = config.roles.vip;
  return Boolean(vipRole && member?.roles?.cache?.has(vipRole));
}

function limitsFor(member) {
  const vip = hasVip(member);
  return {
    maxHomes: vip ? config.teleports.vipMaxHomes : config.teleports.maxHomes,
    cooldownSeconds: vip
      ? config.teleports.vipCooldownSeconds
      : config.teleports.cooldownSeconds,
    delaySeconds: config.teleports.delaySeconds,
  };
}

function parsePosition(raw) {
  if (!raw) return null;
  const text = String(raw);

  // Matches (x, y, z) or (x,y,z) or x,y,z
  const match = text.match(
    /\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/,
  );
  if (!match) return null;

  return {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
}

export async function getPlayerPosition(ign) {
  const response = await sendGameCommand(`server.printpos "${ign}"`);
  const pos = parsePosition(response);
  if (!pos) {
    throw new Error(
      `Couldn't read position for \`${ign}\`. Make sure they're online and standing still.`,
    );
  }
  return pos;
}

export async function teleportPlayer(ign, pos) {
  const coords = `(${pos.x},${pos.y},${pos.z})`;
  // RCE community servers accept this over RCON
  return sendGameCommand(`teleportpos ${coords} "${ign}"`);
}

function logTeleport(line) {
  queueFeedLine(config.channels.tpLog, line);
}

function checkCooldown(discordId, cooldownSeconds) {
  const until = cooldowns.get(discordId) ?? 0;
  const left = Math.ceil((until - Date.now()) / 1000);
  if (left > 0) {
    return { ok: false, error: `Teleport cooldown — try again in **${left}s**.` };
  }
  return { ok: true };
}

function setCooldown(discordId, cooldownSeconds) {
  cooldowns.set(discordId, Date.now() + cooldownSeconds * 1000);
}

export function clearTeleportCooldowns() {
  cooldowns.clear();
  pendingTpr.clear();
  pendingTeleports.clear();
}

async function ensureOnlineLinked(discordId) {
  const linked = await requireLinkedIgn(discordId);
  if (!linked.ok) return linked;

  const online = findOnlinePlayer(linked.ign);
  if (!online) {
    return {
      ok: false,
      error: `\`${linked.ign}\` isn't online. Join the server first.`,
    };
  }

  return { ok: true, ign: linked.ign };
}

export async function setHome(discordId, member, homeName = "home") {
  if (!config.teleports.enabled) {
    return { ok: false, error: "Teleports are disabled." };
  }

  const name = sanitizeHomeName(homeName);
  if (!name) return { ok: false, error: "Home name must be letters/numbers, max 16 chars." };

  const online = await ensureOnlineLinked(discordId);
  if (!online.ok) return online;

  const limits = limitsFor(member);
  const data = await getHomes();
  const player = data.players[discordId] ?? { homes: {} };
  const existing = Object.keys(player.homes);

  if (!player.homes[name] && existing.length >= limits.maxHomes) {
    return {
      ok: false,
      error: `You're at the home limit (**${limits.maxHomes}**). Delete one with \`/delhome\` first.`,
    };
  }

  const pos = await getPlayerPosition(online.ign);
  player.homes[name] = { ...pos, setAt: new Date().toISOString() };
  data.players[discordId] = player;
  await saveHomes(data);

  logTeleport(`🏠 **${online.ign}** set home \`${name}\``);
  return { ok: true, name, pos, ign: online.ign };
}

export async function listHomes(discordId) {
  const data = await getHomes();
  const player = data.players[discordId];
  if (!player || !Object.keys(player.homes).length) {
    return { ok: true, homes: [] };
  }

  return {
    ok: true,
    homes: Object.entries(player.homes).map(([name, pos]) => ({ name, ...pos })),
  };
}

export async function deleteHome(discordId, homeName = "home") {
  const name = sanitizeHomeName(homeName) || "home";
  const data = await getHomes();
  const player = data.players[discordId];
  if (!player?.homes?.[name]) {
    return { ok: false, error: `No home named \`${name}\`.` };
  }

  delete player.homes[name];
  data.players[discordId] = player;
  await saveHomes(data);
  return { ok: true, name };
}

export async function goHome(discordId, member, homeName = "home", onTick) {
  if (!config.teleports.enabled) {
    return { ok: false, error: "Teleports are disabled." };
  }

  const name = sanitizeHomeName(homeName) || "home";
  const online = await ensureOnlineLinked(discordId);
  if (!online.ok) return online;

  const limits = limitsFor(member);
  const cool = checkCooldown(discordId, limits.cooldownSeconds);
  if (!cool.ok) return cool;

  const data = await getHomes();
  const home = data.players[discordId]?.homes?.[name];
  if (!home) {
    return {
      ok: false,
      error: `No home named \`${name}\`. Stand where you want it and run \`/sethome\`.`,
    };
  }

  return runDelayedTeleport({
    discordId,
    ign: online.ign,
    pos: home,
    delaySeconds: limits.delaySeconds,
    cooldownSeconds: limits.cooldownSeconds,
    label: `home \`${name}\``,
    onTick,
  });
}

export async function setWarp(name, discordId) {
  const warpName = sanitizeHomeName(name);
  if (!warpName) return { ok: false, error: "Invalid warp name." };

  const online = await ensureOnlineLinked(discordId);
  if (!online.ok) return online;

  const pos = await getPlayerPosition(online.ign);
  const data = await getHomes();
  data.warps[warpName] = { ...pos, setBy: discordId, setAt: new Date().toISOString() };
  await saveHomes(data);

  logTeleport(`📌 Warp \`${warpName}\` set by **${online.ign}**`);
  return { ok: true, name: warpName, pos };
}

export async function listWarps() {
  const data = await getHomes();
  return Object.keys(data.warps).sort();
}

export async function deleteWarp(name) {
  const warpName = sanitizeHomeName(name);
  const data = await getHomes();
  if (!data.warps[warpName]) return { ok: false, error: `No warp named \`${warpName}\`.` };
  delete data.warps[warpName];
  await saveHomes(data);
  return { ok: true, name: warpName };
}

export async function goWarp(discordId, member, name, onTick) {
  if (!config.teleports.enabled) {
    return { ok: false, error: "Teleports are disabled." };
  }

  const warpName = sanitizeHomeName(name);
  const online = await ensureOnlineLinked(discordId);
  if (!online.ok) return online;

  const limits = limitsFor(member);
  const cool = checkCooldown(discordId, limits.cooldownSeconds);
  if (!cool.ok) return cool;

  const data = await getHomes();
  const warp = data.warps[warpName];
  if (!warp) {
    const available = Object.keys(data.warps);
    return {
      ok: false,
      error: available.length
        ? `Unknown warp. Available: ${available.map((w) => `\`${w}\``).join(", ")}`
        : "No warps set yet. Staff can create one with `/warp set`.",
    };
  }

  return runDelayedTeleport({
    discordId,
    ign: online.ign,
    pos: warp,
    delaySeconds: limits.delaySeconds,
    cooldownSeconds: limits.cooldownSeconds,
    label: `warp \`${warpName}\``,
    onTick,
  });
}

export async function requestTeleport(fromDiscordId, targetIgn) {
  if (!config.teleports.tprEnabled) {
    return { ok: false, error: "Teleport requests are disabled." };
  }

  const from = await ensureOnlineLinked(fromDiscordId);
  if (!from.ok) return from;

  const targetOnline = findOnlinePlayer(targetIgn);
  if (!targetOnline) {
    return { ok: false, error: `\`${targetIgn}\` isn't online.` };
  }

  if (targetOnline.ign.toLowerCase() === from.ign.toLowerCase()) {
    return { ok: false, error: "You can't TPR yourself." };
  }

  const target = await getLinkByIgn(targetOnline.ign);

  const request = {
    fromDiscordId,
    fromIgn: from.ign,
    toIgn: targetOnline.ign,
    toDiscordId: target?.discordId ?? null,
    expiresAt: Date.now() + config.teleports.tprTimeoutSeconds * 1000,
  };

  pendingTpr.set(targetOnline.ign.toLowerCase(), request);
  return { ok: true, request };
}

export async function respondTeleport(toDiscordId, accept, member, onTick) {
  const linked = await requireLinkedIgn(toDiscordId);
  if (!linked.ok) return linked;

  const key = linked.ign.toLowerCase();
  const request = pendingTpr.get(key);
  if (!request || Date.now() > request.expiresAt) {
    pendingTpr.delete(key);
    return { ok: false, error: "No pending teleport request." };
  }

  pendingTpr.delete(key);

  if (!accept) {
    return { ok: true, accepted: false, fromIgn: request.fromIgn };
  }

  const fromOnline = findOnlinePlayer(request.fromIgn);
  const toOnline = findOnlinePlayer(request.toIgn);
  if (!fromOnline || !toOnline) {
    return { ok: false, error: "One of you went offline — request cancelled." };
  }

  const limits = limitsFor(member);
  const cool = checkCooldown(request.fromDiscordId, limits.cooldownSeconds);
  if (!cool.ok) return cool;

  const pos = await getPlayerPosition(request.toIgn);
  const result = await runDelayedTeleport({
    discordId: request.fromDiscordId,
    ign: request.fromIgn,
    pos,
    delaySeconds: limits.delaySeconds,
    cooldownSeconds: limits.cooldownSeconds,
    label: `TPR to **${request.toIgn}**`,
    onTick,
  });

  return { ...result, accepted: true, fromIgn: request.fromIgn };
}

async function runDelayedTeleport({
  discordId,
  ign,
  pos,
  delaySeconds,
  cooldownSeconds,
  label,
  onTick,
}) {
  if (pendingTeleports.has(discordId)) {
    return { ok: false, error: "You already have a teleport in progress." };
  }

  pendingTeleports.set(discordId, true);

  try {
    await sendGameCommand(
      `say <color=#00ffcc>${ign}</color> teleporting in ${delaySeconds}s — don't move`,
    ).catch(() => {});

    if (onTick) await onTick(`Teleporting in **${delaySeconds}s** — stay still…`);

    const startPos = await getPlayerPosition(ign);
    await sleep(delaySeconds * 1000);

    // Cancel if they moved too far (combat logging / bait)
    const nowPos = await getPlayerPosition(ign).catch(() => null);
    if (nowPos && distance(startPos, nowPos) > 3) {
      return { ok: false, error: "Teleport cancelled — you moved." };
    }

    if (!findOnlinePlayer(ign)) {
      return { ok: false, error: "Teleport cancelled — you went offline." };
    }

    await teleportPlayer(ign, pos);
    setCooldown(discordId, cooldownSeconds);
    logTeleport(`✨ **${ign}** teleported → ${label}`);

    await sendGameCommand(`say <color=#00ffcc>${ign}</color> teleported`).catch(() => {});
    return { ok: true, ign, label };
  } finally {
    pendingTeleports.delete(discordId);
  }
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function sanitizeHomeName(name) {
  const cleaned = String(name ?? "home")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 16);
  return cleaned || null;
}

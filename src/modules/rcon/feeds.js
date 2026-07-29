import { EmbedBuilder } from "discord.js";
import { config } from "../../config.js";
import {
  getFeedSettingsSync,
  shouldPostKill,
} from "../admin/feed-settings.js";
import { getPositionFor } from "./live-map.js";

const FLUSH_MS = 3000;
const MAX_CHARS = 1900;
const MAX_EMBEDS = 10;

const buffers = new Map();
const embedBuffers = new Map();
let discordClient = null;
let wsModule = null;
let analyticsModule = null;

export function attachFeedClient(client) {
  discordClient = client;
}

export function attachWebSocket(ws) {
  wsModule = ws;
}

export function attachAnalytics(analytics) {
  analyticsModule = analytics;
}

function feedEnabled(key) {
  const feeds = getFeedSettingsSync();
  return feeds[key]?.enabled !== false;
}

// Batches feed lines per channel — a busy wipe night can produce dozens of
// kills per second, which would blow through Discord's rate limits one-by-one.
export function queueFeedLine(channelId, line) {
  if (!channelId || !discordClient) return;

  let buffer = buffers.get(channelId);
  if (!buffer) {
    buffer = { lines: [], timer: null };
    buffers.set(channelId, buffer);
  }

  buffer.lines.push(line);

  if (!buffer.timer) {
    buffer.timer = setTimeout(() => flushChannel(channelId), FLUSH_MS);
  }
}

function queueFeedEmbed(channelId, embed) {
  if (!channelId || !discordClient) return;

  let buffer = embedBuffers.get(channelId);
  if (!buffer) {
    buffer = { embeds: [], timer: null };
    embedBuffers.set(channelId, buffer);
  }

  buffer.embeds.push(embed);

  if (!buffer.timer) {
    buffer.timer = setTimeout(() => flushEmbedChannel(channelId), FLUSH_MS);
  }
}

async function flushChannel(channelId) {
  const buffer = buffers.get(channelId);
  if (!buffer) return;

  buffer.timer = null;
  const lines = buffer.lines.splice(0, buffer.lines.length);
  if (!lines.length) return;

  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  let chunk = "";
  for (const line of lines) {
    if (chunk.length + line.length + 1 > MAX_CHARS) {
      await channel.send({ content: chunk, allowedMentions: { parse: [] } }).catch(() => {});
      chunk = "";
    }
    chunk += (chunk ? "\n" : "") + line;
  }

  if (chunk) {
    await channel.send({ content: chunk, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

async function flushEmbedChannel(channelId) {
  const buffer = embedBuffers.get(channelId);
  if (!buffer) return;

  buffer.timer = null;
  const embeds = buffer.embeds.splice(0, buffer.embeds.length);
  if (!embeds.length) return;

  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  for (let i = 0; i < embeds.length; i += MAX_EMBEDS) {
    const batch = embeds.slice(i, i + MAX_EMBEDS);
    await channel.send({ embeds: batch, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

export async function flushAllFeeds() {
  await Promise.all([
    ...[...buffers.keys()].map((id) => flushChannel(id)),
    ...[...embedBuffers.keys()].map((id) => flushEmbedChannel(id)),
  ]);
}

async function sendEmbed(channelId, embed) {
  if (!channelId || !discordClient) return;
  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

function clean(name) {
  return String(name ?? "Unknown").replace(/[`*_~|]/g, "");
}

const killStreaks = new Map(); // ign -> count

export function clearKillStreaks() {
  killStreaks.clear();
}
const STREAK_MILESTONES = new Set([3, 5, 10, 15, 20]);

function killDistance(data) {
  const raw =
    data?.distance ??
    data?.Distance ??
    data?.dist ??
    data?.meters ??
    null;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** Horizontal meters between two cached positions (Rust combat distance). */
function horizontalDistance(a, b) {
  if (!a || !b) return null;
  const dx = Number(a.x) - Number(b.x);
  const dz = Number(a.z) - Number(b.z);
  if (![dx, dz].every(Number.isFinite)) return null;
  return Math.round(Math.sqrt(dx * dx + dz * dz));
}

function resolveKillDistance(data, killer, victim) {
  const fromEvent = killDistance(data);
  if (fromEvent != null) return fromEvent;
  return horizontalDistance(
    getPositionFor(killer?.name),
    getPositionFor(victim?.name),
  );
}

function compactKillEmbed({ line }) {
  return new EmbedBuilder()
    .setDescription(line)
    .setColor(0x111214)
    .setTimestamp();
}

function formatCompactPvp({ victim, killer, distance, showDistance = true }) {
  let line = `${clean(killer.name)} killed ${clean(victim.name)}`;
  if (showDistance && distance != null) line += ` · ${distance}m`;
  return line;
}

export function feedKill(data) {
  const channelId = config.channels.killfeed;
  const kf = getFeedSettingsSync().killfeed;

  const killer = data?.killer ?? data;
  const victim = data?.victim;
  const weapon =
    data?.weapon ||
    data?.Weapon ||
    data?.weaponName ||
    data?.WeaponName ||
    data?.item ||
    data?.Item ||
    killer?.weapon ||
    killer?.Weapon ||
    victim?.weapon ||
    null;
  const bodyPart = data?.bodyPart || data?.BodyPart || data?.hitBone || null;
  const headshot =
    Boolean(data?.headshot) ||
    /head/i.test(String(bodyPart ?? ""));
  const distance = resolveKillDistance(data, killer, victim);

  const pvp = killer?.type === "Player" && victim?.type === "Player";
  const suicide = pvp && killer.name === victim.name;

  if (wsModule?.broadcastKillEvent) {
    wsModule.broadcastKillEvent({
      killer: killer?.name,
      victim: victim?.name,
      weapon,
      headshot,
    });
  }

  // Console kills often omit weapon — still count so Analytics isn't empty forever.
  if (analyticsModule?.trackWeaponKill && pvp && !suicide) {
    analyticsModule.trackWeaponKill(weapon || "Unknown").catch(() => {});
  }

  if (analyticsModule?.trackPlayerActivity) {
    if (killer?.name && pvp && !suicide) {
      analyticsModule.trackPlayerActivity(killer.name, "kill").catch(() => {});
    }
    if (victim?.name) {
      analyticsModule.trackPlayerActivity(victim.name, "death").catch(() => {});
    }
  }

  if (!channelId || !shouldPostKill(data, kf)) return;

  if (suicide) {
    killStreaks.delete(String(victim.name).toLowerCase());
    if (kf.style === "compact") {
      queueFeedEmbed(
        channelId,
        compactKillEmbed({
          line: `${clean(victim.name)} died`,
        }),
      );
    } else {
      queueFeedLine(channelId, `💀 **${clean(victim.name)}** died`);
    }
    return;
  }

  if (pvp) {
    const killerKey = String(killer.name).toLowerCase();
    const victimKey = String(victim.name).toLowerCase();
    const streak = (killStreaks.get(killerKey) || 0) + 1;
    killStreaks.set(killerKey, streak);
    killStreaks.delete(victimKey);

    const showStreak = kf.showStreaks && STREAK_MILESTONES.has(streak);
    const streakSuffix = showStreak ? ` · 🔥 ${streak} streak` : "";

    if (kf.style === "compact") {
      queueFeedEmbed(
        channelId,
        compactKillEmbed({
          line:
            formatCompactPvp({
              victim,
              killer,
              distance,
              showDistance: kf.showDistance !== false,
            }) + streakSuffix,
        }),
      );
    } else {
      const extras = [];
      if (weapon) extras.push(clean(weapon));
      if (headshot) extras.push("HS");
      if (kf.showDistance !== false && distance != null) extras.push(`${distance}m`);
      const suffix = extras.length ? ` *(${extras.join(" · ")})*` : "";
      const streakBit = showStreak
        ? ` · 🔥 **${streak}** streak`
        : "";
      queueFeedLine(
        channelId,
        `🔫 **${clean(killer.name)}** killed **${clean(victim.name)}**${suffix}${streakBit}`,
      );
    }
    return;
  }

  // Non-PvP (only reached when settings allow NPC / animal / entity / natural)
  const distSuffix =
    kf.showDistance !== false && distance != null ? ` · ${distance}m` : "";
  if (victim?.type === "Player") {
    killStreaks.delete(String(victim.name).toLowerCase());
    if (kf.style === "compact") {
      queueFeedEmbed(
        channelId,
        compactKillEmbed({
          line: `${clean(killer?.name)} killed ${clean(victim.name)}${distSuffix}`,
        }),
      );
    } else {
      queueFeedLine(
        channelId,
        `☠️ **${clean(victim.name)}** was killed by *${clean(killer?.name)}*`,
      );
    }
  } else if (killer?.type === "Player") {
    if (kf.style === "compact") {
      queueFeedEmbed(
        channelId,
        compactKillEmbed({
          line: `${clean(killer.name)} killed ${clean(victim?.name)}${distSuffix}`,
        }),
      );
    } else {
      queueFeedLine(
        channelId,
        `🐻 **${clean(killer.name)}** killed *${clean(victim?.name)}*`,
      );
    }
  }
}

export function feedJoin(player) {
  if (wsModule?.broadcastPlayerJoin) {
    wsModule.broadcastPlayerJoin(player?.ign);
  }
  if (!feedEnabled("joinLeave")) return;
  queueFeedLine(config.channels.joinLeave, `📥 **${clean(player?.ign)}** joined the server`);
}

export function feedLeave(player) {
  if (wsModule?.broadcastPlayerLeave) {
    wsModule.broadcastPlayerLeave(player?.ign);
  }
  if (!feedEnabled("joinLeave")) return;
  queueFeedLine(config.channels.joinLeave, `📤 **${clean(player?.ign)}** left the server`);
}

export function feedQuickChat({ player, message, type }) {
  if (!feedEnabled("gameChat")) return;
  const channel = type ? `[${type}] ` : "";
  queueFeedLine(config.channels.gameChat, `💬 ${channel}**${clean(player?.ign)}**: ${clean(message)}`);
}

const EVENT_META = {
  Airdrop: { emoji: "📦", color: 0x2ecc71 },
  "Cargo Ship": { emoji: "🚢", color: 0x3498db },
  Chinook: { emoji: "🚁", color: 0x9b59b6 },
  "Patrol Helicopter": { emoji: "🚁", color: 0xe74c3c },
  "Small Oil Rig": { emoji: "🛢️", color: 0xf39c12 },
  "Oil Rig": { emoji: "🛢️", color: 0xe67e22 },
  "Bradley APC Debris": { emoji: "💥", color: 0xe74c3c },
  "Patrol Helicopter Debris": { emoji: "💥", color: 0xe74c3c },
  Halloween: { emoji: "🎃", color: 0xe67e22 },
  Christmas: { emoji: "🎄", color: 0x2ecc71 },
};

export async function feedServerEvent({ event, special }) {
  if (!feedEnabled("gameEvents")) return;
  const meta = EVENT_META[event] ?? { emoji: "🌍", color: 0x95a5a6 };
  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} ${event}${special ? " (Special)" : ""}`)
    .setDescription(`**${event}** has spawned on Astral Vanilla+`)
    .setColor(meta.color)
    .setTimestamp();

  await sendEmbed(config.channels.gameEvents, embed);
}

export function feedAdminAction(text) {
  if (!feedEnabled("adminLog")) return;
  queueFeedLine(config.channels.adminLog, text);
}

export function feedPlayerBanned({ player, admin }) {
  const byName = realAdminName(admin);
  const by = byName ? ` by **${byName}**` : "";
  feedAdminAction(`🔨 **${clean(player?.ign)}** was banned${by}`);
  if (player?.ign) {
    import("../bans/manager.js")
      .then(({ upsertActiveBan }) =>
        upsertActiveBan({
          ign: player.ign,
          reason: "Banned in-game",
          admin: byName || "Game server",
          steamId: player.id || player.steamId || null,
          source: "rcon_event",
        }),
      )
      .catch(() => {});
  }
}

export function feedPlayerUnbanned({ player, admin }) {
  const byName = realAdminName(admin);
  const by = byName ? ` by **${byName}**` : "";
  feedAdminAction(`♻️ **${clean(player?.ign)}** was unbanned${by}`);
  if (player?.ign) {
    import("../bans/manager.js")
      .then(({ unbanPlayer }) =>
        unbanPlayer(player.ign, byName || "Game server", "Unbanned in-game"),
      )
      .catch(() => {});
  }
}

export function feedItemSpawn({ player, item, quantity }) {
  feedAdminAction(`🎁 **${clean(player?.ign)}** spawned \`${quantity}x ${clean(item)}\``);
}

/** RCE reports console / KitManager grants as ign "SERVER" — not a real staff name. */
function realAdminName(admin) {
  const ign = String(admin?.ign ?? "").trim();
  if (!ign) return null;
  if (/^(server|console|system|null|unknown|nitrado)$/i.test(ign)) return null;
  return clean(ign);
}

/** rce.js matches the same console line twice (KitSpawn + KitGive) with kit names like "Tommy" / "Tommy kit". */
function normalizeKitKey(kit) {
  return String(kit ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ kit$/i, "");
}

function kitsAreSameRedeem(a, b) {
  const na = normalizeKitKey(a);
  const nb = normalizeKitKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.startsWith(nb) || nb.startsWith(na);
}

const recentKitPosts = new Map(); // ignLower -> { at, kit }
const KIT_DEDUPE_MS = 5_000;

export function feedKitSpawn({ player, kit, admin }) {
  if (!feedEnabled("adminLog")) return;
  const channelId = config.channels.adminLog;
  if (!channelId) return;

  const playerName = clean(player?.ign);
  const kitName = clean(kit);
  const givenBy = realAdminName(admin);
  const ignKey = playerName.toLowerCase();
  const now = Date.now();

  const prev = recentKitPosts.get(ignKey);
  if (prev && now - prev.at < KIT_DEDUPE_MS && kitsAreSameRedeem(prev.kit, kitName)) {
    return;
  }
  recentKitPosts.set(ignKey, { at: now, kit: kitName });
  for (const [key, entry] of recentKitPosts) {
    if (now - entry.at > KIT_DEDUPE_MS) recentKitPosts.delete(key);
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("📦 Kit Redeemed")
    .setDescription(
      givenBy
        ? `**${playerName}** received \`${kitName}\``
        : `**${playerName}** redeemed \`${kitName}\``,
    )
    .addFields(
      { name: "Player", value: playerName, inline: true },
      { name: "Kit", value: `\`${kitName}\``, inline: true },
      ...(givenBy
        ? [{ name: "Given by", value: givenBy, inline: true }]
        : []),
    )
    .setFooter({ text: "Astral | Vanilla+" })
    .setTimestamp();

  queueFeedEmbed(channelId, embed);
}

export function feedRoleChange({ player, role, admin, added }) {
  const byName = realAdminName(admin);
  const by = byName ? ` by **${byName}**` : "";
  const verb = added ? "was given" : "lost";
  feedAdminAction(`🛡️ **${clean(player?.ign)}** ${verb} role \`${clean(role)}\`${by}`);
}

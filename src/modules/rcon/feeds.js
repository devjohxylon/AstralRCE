import { EmbedBuilder } from "discord.js";
import { config } from "../../config.js";
import {
  getFeedSettingsSync,
  shouldPostKill,
} from "../admin/feed-settings.js";

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

function compactKillEmbed({ line, footerTag, kind = "kill" }) {
  const tag = String(footerTag || "S2").trim() || "S2";
  return new EmbedBuilder()
    .setDescription(line)
    .setColor(0x111214)
    .setFooter({ text: `${tag} • ${kind}` })
    .setTimestamp();
}

function formatCompactPvp({ victim, killer, distance, kf }) {
  const death = kf.deathIcon || "💀";
  const hit = kf.hitIcon || "🎯";
  // KA0SB0T-style: Victim 💀 Killer 🎯 [distance]
  let line = `${clean(victim.name)} ${death} ${clean(killer.name)} ${hit}`;
  if (distance != null) line += ` ${distance}`;
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
    killer?.weapon ||
    data?.item ||
    null;
  const bodyPart = data?.bodyPart || data?.BodyPart || data?.hitBone || null;
  const headshot =
    Boolean(data?.headshot) ||
    /head/i.test(String(bodyPart ?? ""));
  const distance = killDistance(data);

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

  if (analyticsModule?.trackWeaponKill && weapon && pvp && !suicide) {
    analyticsModule.trackWeaponKill(weapon).catch(() => {});
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
          line: `${clean(victim.name)} ${kf.deathIcon || "💀"}`,
          footerTag: kf.footerTag,
          kind: "kill",
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

    if (kf.style === "compact") {
      queueFeedEmbed(
        channelId,
        compactKillEmbed({
          line: formatCompactPvp({ victim, killer, distance, kf }),
          footerTag: kf.footerTag,
          kind: "kill",
        }),
      );
    } else {
      const extras = [];
      if (weapon) extras.push(clean(weapon));
      if (headshot) extras.push("HS");
      if (distance != null) extras.push(`${distance}m`);
      const suffix = extras.length ? ` *(${extras.join(" · ")})*` : "";
      queueFeedLine(
        channelId,
        `🔫 **${clean(killer.name)}** killed **${clean(victim.name)}**${suffix}`,
      );
    }

    if (kf.showStreaks && STREAK_MILESTONES.has(streak)) {
      if (kf.style === "compact") {
        queueFeedEmbed(
          channelId,
          compactKillEmbed({
            line: `🔥 ${clean(killer.name)} · ${streak} streak`,
            footerTag: kf.footerTag,
            kind: "streak",
          }),
        );
      } else {
        queueFeedLine(
          channelId,
          `🔥 **${clean(killer.name)}** is on a **${streak}** kill streak`,
        );
      }
    }
    return;
  }

  // Non-PvP (only reached when settings allow NPC / animal / entity / natural)
  if (victim?.type === "Player") {
    killStreaks.delete(String(victim.name).toLowerCase());
    if (kf.style === "compact") {
      queueFeedEmbed(
        channelId,
        compactKillEmbed({
          line: `${clean(victim.name)} ${kf.deathIcon || "💀"} ${clean(killer?.name)}`,
          footerTag: kf.footerTag,
          kind: "kill",
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
          line: `${clean(victim?.name)} ${kf.deathIcon || "💀"} ${clean(killer.name)}`,
          footerTag: kf.footerTag,
          kind: "kill",
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
  const by = admin?.ign ? ` by **${clean(admin.ign)}**` : "";
  feedAdminAction(`🔨 **${clean(player?.ign)}** was banned${by}`);
  if (player?.ign) {
    import("../bans/manager.js")
      .then(({ upsertActiveBan }) =>
        upsertActiveBan({
          ign: player.ign,
          reason: "Banned in-game",
          admin: admin?.ign || "Game server",
          steamId: player.id || player.steamId || null,
          source: "rcon_event",
        }),
      )
      .catch(() => {});
  }
}

export function feedPlayerUnbanned({ player, admin }) {
  const by = admin?.ign ? ` by **${clean(admin.ign)}**` : "";
  feedAdminAction(`♻️ **${clean(player?.ign)}** was unbanned${by}`);
  if (player?.ign) {
    import("../bans/manager.js")
      .then(({ unbanPlayer }) =>
        unbanPlayer(player.ign, admin?.ign || "Game server", "Unbanned in-game"),
      )
      .catch(() => {});
  }
}

export function feedItemSpawn({ player, item, quantity }) {
  feedAdminAction(`🎁 **${clean(player?.ign)}** spawned \`${quantity}x ${clean(item)}\``);
}

export function feedKitSpawn({ player, kit, admin }) {
  const by = admin?.ign ? ` (given by **${clean(admin.ign)}**)` : "";
  feedAdminAction(`📦 **${clean(player?.ign)}** redeemed kit \`${clean(kit)}\`${by}`);
}

export function feedRoleChange({ player, role, admin, added }) {
  const by = admin?.ign ? ` by **${clean(admin.ign)}**` : "";
  const verb = added ? "was given" : "lost";
  feedAdminAction(`🛡️ **${clean(player?.ign)}** ${verb} role \`${clean(role)}\`${by}`);
}

import { EmbedBuilder } from "discord.js";
import { config } from "../../config.js";

const FLUSH_MS = 3000;
const MAX_CHARS = 1900;

const buffers = new Map();
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

export async function flushAllFeeds() {
  await Promise.all([...buffers.keys()].map((id) => flushChannel(id)));
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

export function feedKill(data) {
  const channelId = config.channels.killfeed;

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

  if (!channelId) return;

  if (suicide) {
    killStreaks.delete(String(victim.name).toLowerCase());
    queueFeedLine(channelId, `💀 **${clean(victim.name)}** died`);
    return;
  }

  if (pvp) {
    const killerKey = String(killer.name).toLowerCase();
    const victimKey = String(victim.name).toLowerCase();
    const streak = (killStreaks.get(killerKey) || 0) + 1;
    killStreaks.set(killerKey, streak);
    killStreaks.delete(victimKey);

    const extras = [];
    if (weapon) extras.push(clean(weapon));
    if (headshot) extras.push("HS");
    const suffix = extras.length ? ` *(${extras.join(" · ")})*` : "";

    queueFeedLine(
      channelId,
      `🔫 **${clean(killer.name)}** killed **${clean(victim.name)}**${suffix}`,
    );

    if (STREAK_MILESTONES.has(streak)) {
      queueFeedLine(
        channelId,
        `🔥 **${clean(killer.name)}** is on a **${streak}** kill streak`,
      );
    }
    return;
  }

  if (victim?.type === "Player") {
    killStreaks.delete(String(victim.name).toLowerCase());
    queueFeedLine(
      channelId,
      `☠️ **${clean(victim.name)}** was killed by *${clean(killer?.name)}*`,
    );
  } else if (killer?.type === "Player") {
    queueFeedLine(
      channelId,
      `🐻 **${clean(killer.name)}** killed *${clean(victim?.name)}*`,
    );
  }
}

export function feedJoin(player) {
  if (wsModule?.broadcastPlayerJoin) {
    wsModule.broadcastPlayerJoin(player?.ign);
  }
  queueFeedLine(config.channels.joinLeave, `📥 **${clean(player?.ign)}** joined the server`);
}

export function feedLeave(player) {
  if (wsModule?.broadcastPlayerLeave) {
    wsModule.broadcastPlayerLeave(player?.ign);
  }
  queueFeedLine(config.channels.joinLeave, `📤 **${clean(player?.ign)}** left the server`);
}

export function feedQuickChat({ player, message, type }) {
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
  const meta = EVENT_META[event] ?? { emoji: "🌍", color: 0x95a5a6 };
  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} ${event}${special ? " (Special)" : ""}`)
    .setDescription(`**${event}** has spawned on Astral Vanilla+`)
    .setColor(meta.color)
    .setTimestamp();

  await sendEmbed(config.channels.gameEvents, embed);
}

export function feedAdminAction(text) {
  queueFeedLine(config.channels.adminLog, text);
}

export function feedPlayerBanned({ player, admin }) {
  const by = admin?.ign ? ` by **${clean(admin.ign)}**` : "";
  feedAdminAction(`🔨 **${clean(player?.ign)}** was banned${by}`);
}

export function feedPlayerUnbanned({ player, admin }) {
  const by = admin?.ign ? ` by **${clean(admin.ign)}**` : "";
  feedAdminAction(`♻️ **${clean(player?.ign)}** was unbanned${by}`);
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

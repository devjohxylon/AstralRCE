import { config } from "../../config.js";
import { getLinkByDiscord, getLinkByIgn } from "./linking.js";
import { giveKit } from "./kits.js";
import { sendGameCommand, isRconEnabled } from "./client.js";
import { queueFeedLine } from "./feeds.js";
import {
  findVipClaim,
  recordVipClaim,
  vipPostWipeLockRemainingSeconds,
} from "./vip-claims.js";

const recentGrants = new Map(); // discordId -> timestamp (legacy auto-grant)
const GRANT_COOLDOWN_MS = 60_000;

let discordClient = null;

export function attachVipClient(client) {
  discordClient = client;
}

function fillTemplate(template, ign) {
  return String(template).replaceAll("{ign}", ign).replaceAll("{player}", ign);
}

function claimPhrases() {
  const raw = config.vip.claimPhrase || "i need stone";
  return String(raw)
    .split("|")
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean);
}

/**
 * Rust RCE quick-chat events are NOT human text — they look like:
 *   d11_quick_chat_i_need_phrase_format d11_Water
 *   d11_quick_chat_i_need_phrase_format stones
 * Map friendly claim phrases → tokens that appear in those payloads.
 */
const NEED_RESOURCE_TOKENS = {
  water: ["d11_water", "water"],
  stone: ["stones", "d11_stone", "stone"],
  stones: ["stones", "d11_stone", "stone"],
  wood: ["d11_wood", "wood"],
  scrap: ["d11_scrap", "scrap"],
  food: ["d11_food", "food"],
  "metal fragments": ["d11_metal_fragments", "metal_fragments", "metal fragments"],
  "high quality metal": ["metal.refined", "metal refined", "high quality metal"],
  "low grade fuel": ["lowgradefuel", "low grade fuel"],
};

/** Normalize quick-chat text for matching. */
export function normalizeQuickChat(message) {
  return String(message ?? "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isVipClaimPhrase(message) {
  const raw = String(message ?? "").trim();
  if (!raw) return false;
  const text = normalizeQuickChat(raw);
  const rawLower = raw.toLowerCase();

  const isRceNeedFormat =
    rawLower.includes("d11_quick_chat_i_need_phrase_format") ||
    text.includes("i need phrase format");

  for (const phrase of claimPhrases()) {
    // Human-readable chat / custom text
    if (text === phrase || text.includes(phrase)) return true;

    // Raw RCE token configured directly as the phrase
    if (rawLower === phrase || rawLower.includes(phrase)) return true;

    // "i need stone" → match RCE payload ending in stones / d11_Water etc.
    const needMatch = phrase.match(/^i\s+need\s+(.+)$/);
    if (needMatch && isRceNeedFormat) {
      const resource = needMatch[1].trim();
      const tokens = NEED_RESOURCE_TOKENS[resource] || [resource.replace(/\s+/g, "_"), resource];
      if (tokens.some((t) => rawLower.includes(t) || text.includes(t))) {
        return true;
      }
    }
  }
  return false;
}

async function sayToServer(line) {
  if (!isRconEnabled()) return;
  const safe = String(line).replace(/"/g, "").slice(0, 180);
  await sendGameCommand(`say ${safe}`).catch(() => {});
}

function formatLockRemaining(seconds) {
  const s = Math.max(0, Math.ceil(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.ceil((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

async function runGrant(ign, reason) {
  if (config.vip.grantCommand) {
    const cmd = fillTemplate(config.vip.grantCommand, ign);
    await sendGameCommand(cmd);
    return { ok: true, via: "command", command: cmd, reason };
  }

  const kitId = config.vip.kitId || "vipkit";
  const result = await giveKit(ign, kitId, { bypassCooldown: true });
  if (!result.ok && result.error?.includes("not found")) {
    return {
      ok: false,
      error: `VIP kit \`${kitId}\` missing — create it in the admin Kits tab or as a server kit`,
    };
  }
  return { ...result, via: "kit", kitId, reason };
}

async function runRevoke(ign) {
  if (!config.vip.revokeCommand) return { ok: true, skipped: true };
  const cmd = fillTemplate(config.vip.revokeCommand, ign);
  await sendGameCommand(cmd);
  return { ok: true, via: "command", command: cmd };
}

function logVip(line) {
  queueFeedLine(config.channels.adminLog, line);
}

async function fetchGuildMember(discordId) {
  if (!discordClient || !discordId) return null;
  const guild = config.discord.guildId
    ? await discordClient.guilds.fetch(config.discord.guildId).catch(() => null)
    : discordClient.guilds.cache.first() || null;
  if (!guild) return null;
  return guild.members.fetch(discordId).catch(() => null);
}

function memberHasVipRole(member) {
  if (!member?.roles?.cache) return false;
  const roleId = config.roles.vip;
  if (roleId && member.roles.cache.has(roleId)) return true;
  // Fallback: role named VIP / vip (case-insensitive)
  return member.roles.cache.some((r) => /^vip$/i.test(String(r.name || "").trim()));
}

/** True if linked Discord account has ROLE_VIP (or a role named VIP). */
export async function playerHasDiscordVip(ign) {
  const link = await getLinkByIgn(ign);
  if (!link?.discordId) return false;
  const member = await fetchGuildMember(link.discordId);
  if (!member) return false;
  // If ROLE_VIP isn't configured, still allow a role literally named "VIP"
  if (!config.roles.vip) {
    return member.roles.cache.some((r) => /^vip$/i.test(String(r.name || "").trim()));
  }
  return memberHasVipRole(member);
}

/**
 * Claim VIP kit from in-game quick chat (default: "I need stone").
 * Requires Discord VIP role + linked account.
 * Default: once per wipe, blocked for N hours after wipe automation.
 */
export async function tryClaimVipFromQuickChat({ player, message } = {}) {
  if (!config.vip.claimEnabled) return null;
  if (!isVipClaimPhrase(message)) return null;

  const ign = String(player?.ign || player?.name || "").trim();
  if (!ign) return { ok: false, error: "Unknown player" };

  const link = await getLinkByIgn(ign);
  if (!link?.discordId) {
    await sayToServer(
      `<color=#ff6b73>${ign}</color> — link Discord first (/link) to claim VIP`,
    );
    return { ok: false, error: "Not linked", ign };
  }

  const hasVip = await playerHasDiscordVip(ign);
  if (!hasVip) {
    await sayToServer(
      `<color=#ff6b73>${ign}</color> — VIP only (need the Discord VIP role)`,
    );
    return { ok: false, error: "Not VIP", ign };
  }

  const lockHours = Number(config.vip.postWipeLockHours);
  const lockLeft = await vipPostWipeLockRemainingSeconds(
    Number.isFinite(lockHours) ? lockHours : 4,
  );
  if (lockLeft > 0) {
    await sayToServer(
      `<color=#e8c06a>${ign}</color> — VIP kits unlock in ${formatLockRemaining(lockLeft)} (post-wipe)`,
    );
    return { ok: false, error: "Post-wipe lock", ign, leftSeconds: lockLeft };
  }

  if (config.vip.oncePerWipe !== false) {
    const existing = await findVipClaim({ ign, discordId: link.discordId });
    if (existing) {
      await sayToServer(
        `<color=#e8c06a>${ign}</color> — already claimed VIP this wipe`,
      );
      return { ok: false, error: "Already claimed this wipe", ign };
    }
  }

  try {
    const result = await runGrant(ign, "quickchat_claim");
    if (!result.ok) {
      await sayToServer(
        `<color=#ff6b73>${ign}</color> — VIP claim failed (${result.error || "error"})`,
      );
      return result;
    }

    if (config.vip.oncePerWipe !== false) {
      await recordVipClaim({
        ign,
        discordId: link.discordId,
        kitId: result.kitId || config.vip.kitId,
      });
    }

    await sayToServer(
      `<color=#c9a227>${ign}</color> claimed their <color=#c9a227>VIP</color> kit`,
    );
    logVip(`💎 **${ign}** claimed VIP kit via quick chat (<@${link.discordId}>)`);
    return { ok: true, ign, ...result };
  } catch (error) {
    await sayToServer(`<color=#ff6b73>${ign}</color> — VIP claim failed`);
    return { ok: false, error: error.message, ign };
  }
}

/** Legacy auto-grant when Discord VIP is detected (join / role / link). Off by default. */
export async function syncVipForDiscord(discordId, member, { force = false } = {}) {
  if (!config.vip.autoGrant) return { ok: true, skipped: true, reason: "auto_grant_off" };
  if (!discordId) return { ok: false, error: "Missing discord id" };

  const link = await getLinkByDiscord(discordId);
  if (!link?.ign) return { ok: false, error: "Not linked" };

  const hasVip = memberHasVipRole(member);
  if (!hasVip) return { ok: true, skipped: true, reason: "no_vip_role" };

  const last = recentGrants.get(discordId) || 0;
  if (!force && Date.now() - last < GRANT_COOLDOWN_MS) {
    return { ok: true, skipped: true, reason: "cooldown" };
  }

  try {
    const result = await runGrant(link.ign, "vip_sync");
    if (result.ok) {
      recentGrants.set(discordId, Date.now());
      logVip(`💎 VIP granted in-game to **${link.ign}** (<@${discordId}>)`);
    }
    return result;
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function syncVipOnJoin(ign) {
  if (!ign) return null;
  const link = await getLinkByIgn(ign);
  if (!link?.discordId) return null;
  return { discordId: link.discordId, ign: link.ign || ign };
}

export async function handleVipRoleChange(member, added) {
  const link = await getLinkByDiscord(member.id);
  if (!link?.ign) return { ok: false, error: "Not linked" };

  if (added) {
    const phrase = config.vip.claimPhrase || "I need stone";
    logVip(
      `💎 <@${member.id}> got VIP role (linked **${link.ign}**) — claim in-game with quick chat **${phrase}**`,
    );
    if (config.vip.autoGrant) {
      return syncVipForDiscord(member.id, member, { force: true });
    }
    return { ok: true, skipped: true, reason: "claim_via_quickchat" };
  }

  try {
    const result = await runRevoke(link.ign);
    if (result.ok && !result.skipped) {
      logVip(`💎 VIP revoke command run for **${link.ign}** (<@${member.id}>)`);
    }
    return result;
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

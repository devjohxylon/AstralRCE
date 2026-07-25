import { config } from "../../config.js";
import { getLinkByDiscord, getLinkByIgn } from "./linking.js";
import { giveKit } from "./kits.js";
import { sendGameCommand } from "./client.js";
import { queueFeedLine } from "./feeds.js";

const recentGrants = new Map(); // discordId -> timestamp
const GRANT_COOLDOWN_MS = 60_000;

function fillTemplate(template, ign) {
  return String(template).replaceAll("{ign}", ign).replaceAll("{player}", ign);
}

async function runGrant(ign, reason) {
  if (config.vip.grantCommand) {
    const cmd = fillTemplate(config.vip.grantCommand, ign);
    await sendGameCommand(cmd);
    return { ok: true, via: "command", command: cmd };
  }

  const kitId = config.vip.kitId || "vip";
  const result = await giveKit(ign, kitId, { bypassCooldown: true });
  if (!result.ok && result.error?.includes("not found")) {
    return {
      ok: false,
      error: `VIP kit \`${kitId}\` missing — create it in the admin Kits tab`,
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

export async function syncVipForDiscord(discordId, member, { force = false } = {}) {
  if (!config.roles.vip || !discordId) return { ok: false, error: "ROLE_VIP not set" };

  const link = await getLinkByDiscord(discordId);
  if (!link?.ign) return { ok: false, error: "Not linked" };

  const hasVip = Boolean(member?.roles?.cache?.has(config.roles.vip));
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
  if (!config.roles.vip || !ign) return null;
  const link = await getLinkByIgn(ign);
  if (!link?.discordId) return null;
  return { discordId: link.discordId, ign: link.ign || ign };
}

export async function handleVipRoleChange(member, added) {
  if (!config.roles.vip) return null;
  const link = await getLinkByDiscord(member.id);
  if (!link?.ign) return { ok: false, error: "Not linked" };

  if (added) {
    return syncVipForDiscord(member.id, member, { force: true });
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

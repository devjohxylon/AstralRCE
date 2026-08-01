import { PermissionFlagsBits } from "discord.js";
import { addCase, getCasesForUser, getSettings, saveSettings } from "../../data/store.js";
import { sendModLog } from "../../lib/modlog.js";
import { config } from "../../config.js";

export async function recordCase({ guild, userId, moderatorId, action, reason, duration }) {
  const record = {
    id: crypto.randomUUID(),
    guildId: guild.id,
    userId,
    moderatorId,
    action,
    reason: reason ?? "No reason provided",
    duration: duration ?? null,
    at: new Date().toISOString(),
  };
  await addCase(record);
  await sendModLog(guild, {
    title: `Case: ${action}`,
    userId,
    moderatorId,
    reason: record.reason,
  });
  return record;
}

export async function warnMember(interaction, user, reason) {
  const record = await recordCase({
    guild: interaction.guild,
    userId: user.id,
    moderatorId: interaction.user.id,
    action: "WARN",
    reason,
  });

  const prior = await getCasesForUser(user.id);
  const warnCount = prior.filter((c) => c.action === "WARN").length;

  if (warnCount >= config.moderation.autoMuteAfterWarns) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) {
      await member.timeout(config.moderation.autoMuteMinutes * 60_000, `Auto-mute: ${warnCount} warnings`);
    }
  }

  return { record, warnCount };
}

export async function muteMember(interaction, user, minutes, reason) {
  const member = await interaction.guild.members.fetch(user.id);
  await member.timeout(minutes * 60_000, reason);
  return recordCase({
    guild: interaction.guild,
    userId: user.id,
    moderatorId: interaction.user.id,
    action: "MUTE",
    reason,
    duration: `${minutes}m`,
  });
}

export async function kickMember(interaction, user, reason) {
  const member = await interaction.guild.members.fetch(user.id);
  await member.kick(reason);
  return recordCase({
    guild: interaction.guild,
    userId: user.id,
    moderatorId: interaction.user.id,
    action: "KICK",
    reason,
  });
}

export async function banMember(interaction, user, reason, deleteDays) {
  await interaction.guild.members.ban(user.id, {
    reason,
    deleteMessageSeconds: deleteDays * 86_400,
  });
  return recordCase({
    guild: interaction.guild,
    userId: user.id,
    moderatorId: interaction.user.id,
    action: "BAN",
    reason,
  });
}

export async function setRaidMode(guild, enabled) {
  const settings = await getSettings();
  const everyone = guild.roles.everyone;

  if (enabled) {
    const locked = [];
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isTextBased?.()) continue;
      locked.push(channel.id);
      await channel.permissionOverwrites
        .edit(everyone, { SendMessages: false })
        .catch(() => {});
    }
    settings.raidMode = true;
    settings.lockedChannelIds = locked;
    await saveSettings(settings);
    await sendModLog(guild, {
      title: "🚨 RAID MODE ENABLED",
      description: "All text channels locked for @everyone.",
    });
    return locked.length;
  }

  for (const channelId of settings.lockedChannelIds ?? []) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) continue;
    await channel.permissionOverwrites.delete(everyone).catch(() => {});
  }
  settings.raidMode = false;
  settings.lockedChannelIds = [];
  await saveSettings(settings);
  await sendModLog(guild, {
    title: "Raid mode disabled",
    description: "Channel permissions restored.",
  });
  return 0;
}

export async function lockChannel(channel, lock) {
  const everyone = channel.guild.roles.everyone;
  if (lock) {
    await channel.permissionOverwrites.edit(everyone, { SendMessages: false });
  } else {
    await channel.permissionOverwrites.delete(everyone);
  }
}

export async function triggerRaidAlert(guild, joinCount) {
  const { getSettings, saveSettings } = await import("../../data/store.js");
  const settings = await getSettings().catch(() => null);
  if (settings) {
    settings.raidAlerts = Array.isArray(settings.raidAlerts) ? settings.raidAlerts : [];
    settings.raidAlerts.unshift({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      joinCount,
      windowSeconds: config.automod.raidWindowSeconds,
    });
    settings.raidAlerts = settings.raidAlerts.slice(0, 50);
    await saveSettings(settings).catch(() => {});
  }

  await sendModLog(guild, {
    title: "⚠️ Possible raid detected",
    description: `${joinCount} joins in ${config.automod.raidWindowSeconds}s. Consider \`/raidmode on\`.`,
  });
  if (config.channels.staffAlert) {
    const ch = guild.channels.cache.get(config.channels.staffAlert);
    if (ch?.isTextBased()) {
      await ch.send(`🚨 **Raid alert:** ${joinCount} joins in ${config.automod.raidWindowSeconds}s`);
    }
  }
}

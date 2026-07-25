import { EmbedBuilder } from "discord.js";
import { config } from "../config.js";

const TYPE_META = {
  report: { label: "Report Player", emoji: "🚨", color: 0xe74c3c },
  vip: { label: "VIP / Billing", emoji: "💎", color: 0x9b59b6 },
  appeal: { label: "Ban Appeal", emoji: "📋", color: 0xf39c12 },
  general: { label: "General Support", emoji: "💬", color: 0x3498db },
};

export function getTicketLogChannel(guild) {
  const channelId = config.channels.ticketLog || config.channels.modLog;
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId);
  return channel?.isTextBased() ? channel : null;
}

export async function logTicketOpened(guild, { ticket, channel, member }) {
  const log = getTicketLogChannel(guild);
  if (!log) {
    console.warn(
      "Ticket opened but no log channel set — add CHANNEL_TICKET_LOG or CHANNEL_MOD_LOG to .env",
    );
    return;
  }

  const meta = TYPE_META[ticket.type] ?? TYPE_META.general;
  const staffMentions = config.roles.staff.map((id) => `<@&${id}>`).join(" ");

  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} Ticket opened — ${meta.label}`)
    .setColor(meta.color)
    .addFields(
      { name: "User", value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
      { name: "Type", value: meta.label, inline: true },
      { name: "Channel", value: `${channel}`, inline: true },
      { name: "Ticket ID", value: `\`${ticket.id}\``, inline: false },
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
    .setFooter({ text: "Astral Support" })
    .setTimestamp();

  await log
    .send({
      content: staffMentions || undefined,
      embeds: [embed],
      allowedMentions: { roles: config.roles.staff },
    })
    .catch((error) => console.error("Ticket open log failed:", error.message));
}

export async function logTicketClosed(guild, { ticket, closedById }) {
  const log = getTicketLogChannel(guild);
  if (!log) return;

  const meta = TYPE_META[ticket.type] ?? TYPE_META.general;
  const openedAt = ticket.createdAt ? new Date(ticket.createdAt) : null;
  const closedAt = ticket.closedAt ? new Date(ticket.closedAt) : new Date();
  const durationMs = openedAt ? closedAt.getTime() - openedAt.getTime() : 0;
  const duration = formatDuration(durationMs);

  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} Ticket closed — ${meta.label}`)
    .setColor(0x95a5a6)
    .addFields(
      { name: "User", value: `<@${ticket.userId}>`, inline: true },
      { name: "Closed by", value: `<@${closedById}>`, inline: true },
      { name: "Duration", value: duration, inline: true },
      { name: "Ticket ID", value: `\`${ticket.id}\``, inline: false },
    )
    .setFooter({ text: "Transcript attached below when available" })
    .setTimestamp();

  await log.send({ embeds: [embed] }).catch((error) =>
    console.error("Ticket close log failed:", error.message),
  );
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "unknown";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return `${hours}h ${rem}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

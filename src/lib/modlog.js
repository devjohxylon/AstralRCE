import { EmbedBuilder } from "discord.js";
import { config } from "../config.js";

export async function sendModLog(guild, fields) {
  const channelId = config.channels.modLog;
  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(fields.title ?? "Moderation action")
    .setTimestamp();

  if (fields.description) embed.setDescription(fields.description);
  if (fields.userId) embed.addFields({ name: "User", value: `<@${fields.userId}>`, inline: true });
  if (fields.moderatorId) {
    embed.addFields({ name: "Staff", value: `<@${fields.moderatorId}>`, inline: true });
  }
  if (fields.reason) embed.addFields({ name: "Reason", value: fields.reason.slice(0, 1024) });
  if (fields.extra) embed.addFields(fields.extra);

  await channel.send({ embeds: [embed] }).catch(() => {});
}

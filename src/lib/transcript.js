import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { getTicketLogChannel } from "./ticket-log.js";

const MAX_MESSAGES = 500;

function formatLine(message) {
  const time = message.createdAt.toISOString().replace("T", " ").slice(0, 19);
  const author = message.author?.bot
    ? `[BOT] ${message.author.tag}`
    : `${message.author?.tag ?? "Unknown"} (${message.author?.id})`;
  const content = message.content?.trim() || "";
  const attachments = [...message.attachments.values()].map((a) => a.url).join(" ");
  const embedNote = message.embeds.length > 0 ? ` [${message.embeds.length} embed(s)]` : "";
  const body = [content, attachments].filter(Boolean).join(" ");
  return `[${time}] ${author}: ${body || "(no text)"}${embedNote}`;
}

export async function buildChannelTranscript(channel) {
  const lines = [];
  let lastId;

  while (lines.length < MAX_MESSAGES) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });
    if (batch.size === 0) break;

    const sorted = [...batch.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    for (const message of sorted) {
      lines.push(formatLine(message));
    }
    lastId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  return lines.join("\n");
}

export async function sendTicketTranscript(guild, ticket, closedById) {
  const logChannel = getTicketLogChannel(guild);
  if (!logChannel) return;

  const ticketChannel = guild.channels.cache.get(ticket.channelId);
  if (!ticketChannel?.isTextBased()) {
    await logChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("📋 Ticket closed (no transcript)")
          .setDescription(`Ticket \`${ticket.id}\` — channel already deleted.`)
          .setColor(0x95a5a6),
      ],
    });
    return;
  }

  const transcript = await buildChannelTranscript(ticketChannel);
  const filename = `ticket-${ticket.type}-${ticket.userId}-${Date.now()}.txt`;
  const header = [
    "ASTRAL SUPPORT TICKET TRANSCRIPT",
    "==============================",
    `Ticket ID: ${ticket.id}`,
    `Type: ${ticket.type}`,
    `Opened by: ${ticket.userId}`,
    `Closed by: ${closedById}`,
    `Opened: ${ticket.createdAt}`,
    `Closed: ${ticket.closedAt ?? new Date().toISOString()}`,
    `Channel: ${ticket.channelId}`,
    "",
    "MESSAGES",
    "--------",
    "",
  ].join("\n");

  const fullText = header + (transcript || "(no messages)");
  const file = new AttachmentBuilder(Buffer.from(fullText, "utf8"), { name: filename });

  const preview = transcript
    .split("\n")
    .slice(-8)
    .join("\n")
    .slice(0, 900);

  const embed = new EmbedBuilder()
    .setTitle("📋 Ticket transcript")
    .setColor(0x3498db)
    .addFields(
      { name: "User", value: `<@${ticket.userId}>`, inline: true },
      { name: "Type", value: ticket.type, inline: true },
      { name: "Closed by", value: `<@${closedById}>`, inline: true },
    )
    .setDescription(preview ? `\`\`\`\n${preview}\n\`\`\`` : "See attached file.")
    .setFooter({ text: `Full log: ${filename}` })
    .setTimestamp();

  await logChannel.send({ embeds: [embed], files: [file] });
}

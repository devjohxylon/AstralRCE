import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { getTickets, saveTickets } from "../../data/store.js";
import { config } from "../../config.js";
import { sendTicketTranscript } from "../../lib/transcript.js";
import { logTicketOpened, logTicketClosed } from "../../lib/ticket-log.js";

const TICKET_TYPES = {
  report: { label: "Report Player", emoji: "🚨" },
  vip: { label: "VIP / Billing", emoji: "💎" },
  appeal: { label: "Ban Appeal", emoji: "📋" },
  general: { label: "General Support", emoji: "💬" },
};

export function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("Astral Support Tickets")
    .setColor(0x3498db)
    .setDescription(
      "Need help? Open a ticket and staff will respond.\n\n" +
        "🚨 **Report** — rule breakers / cheaters\n" +
        "💎 **VIP** — store / billing issues\n" +
        "📋 **Appeal** — ban or mute appeal\n" +
        "💬 **General** — anything else",
    );
}

export function buildTicketPanelRow() {
  return new ActionRowBuilder().addComponents(
    Object.entries(TICKET_TYPES).map(([id, meta]) =>
      new ButtonBuilder()
        .setCustomId(`ticket:open:${id}`)
        .setLabel(meta.label)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(meta.emoji),
    ),
  );
}

async function resolveTicketCategory(guild, panelChannel) {
  const configured = config.channels.ticketCategory;
  if (configured) {
    const category = await guild.channels.fetch(configured).catch(() => null);
    if (category?.type === ChannelType.GuildCategory) return category.id;
    console.warn(`CATEGORY_TICKETS (${configured}) is not a valid category in this server.`);
  }
  // Fall back to the category the ticket panel lives in
  return panelChannel?.parentId ?? null;
}

export async function openTicket(guild, member, type, panelChannel = null) {
  const data = await getTickets();
  const existing = data.open.find((t) => t.userId === member.id && t.status === "open");
  if (existing) {
    // If the channel was deleted manually, drop the stale record and let them open a new one
    const channelStillExists = await guild.channels
      .fetch(existing.channelId)
      .catch(() => null);
    if (channelStillExists) {
      return { ok: false, error: `You already have an open ticket: <#${existing.channelId}>` };
    }
    data.open = data.open.filter((t) => t.id !== existing.id);
    await saveTickets(data);
  }

  const meta = TICKET_TYPES[type] ?? TICKET_TYPES.general;
  const parentId = await resolveTicketCategory(guild, panelChannel);

  // Only include staff roles that actually exist, so a bad ID can't break creation
  const staffRoleIds = config.roles.staff.filter((roleId) => guild.roles.cache.has(roleId));
  if (config.roles.staff.length && !staffRoleIds.length) {
    console.warn("None of ROLE_STAFF_IDS match roles in this server — staff won't see tickets.");
  } else if (!config.roles.staff.length) {
    console.warn("ROLE_STAFF_IDS is not set — only the ticket opener and admins can see tickets.");
  }

  const channel = await guild.channels.create({
    name: `ticket-${member.user.username}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: parentId,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      ...staffRoleIds.map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      })),
    ],
  });

  const ticket = {
    id: crypto.randomUUID(),
    guildId: guild.id,
    channelId: channel.id,
    userId: member.id,
    type,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  data.open.push(ticket);
  await saveTickets(data);

  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} ${meta.label}`)
    .setDescription(
      `Thanks <@${member.id}> — staff will be with you shortly.\n\n` +
        "Please describe your issue in detail. For reports, include proof (clips/screenshots).",
    )
    .setColor(0x3498db);

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticket.id}`)
      .setLabel("Close ticket")
      .setStyle(ButtonStyle.Danger),
  );

  await channel.send({ content: `<@${member.id}>`, embeds: [embed], components: [closeRow] });

  await logTicketOpened(guild, { ticket, channel, member });

  return { ok: true, channel, ticket };
}

export async function closeTicket(guild, ticketId, closedById, { channelId = null } = {}) {
  const data = await getTickets();
  let ticket =
    (ticketId && data.open.find((t) => t.id === ticketId)) ||
    (channelId && data.open.find((t) => t.channelId === channelId)) ||
    null;

  // Channel still exists but the store lost the record (redeploy / volume wipe)
  if (!ticket && channelId) {
    const channel =
      guild.channels.cache.get(channelId) ||
      (await guild.channels.fetch(channelId).catch(() => null));
    if (channel?.isTextBased()) {
      await channel
        .send(`🔒 Ticket closed by <@${closedById}>. Channel will delete in 15s.`)
        .catch(() => {});
      setTimeout(() => channel.delete().catch(() => {}), 15_000);
      return {
        ok: true,
        ticket: { id: ticketId || "orphan", channelId, userId: null, orphan: true },
      };
    }
    return { ok: false, error: "Ticket not found." };
  }

  if (!ticket) return { ok: false, error: "Ticket not found." };

  ticket.status = "closed";
  ticket.closedAt = new Date().toISOString();
  ticket.closedBy = closedById;
  data.open = data.open.filter((t) => t.id !== ticket.id);
  if (!Array.isArray(data.closed)) data.closed = [];
  data.closed.unshift({
    id: ticket.id,
    guildId: ticket.guildId || null,
    channelId: ticket.channelId || null,
    userId: ticket.userId || null,
    type: ticket.type || "general",
    status: "closed",
    createdAt: ticket.createdAt || null,
    closedAt: ticket.closedAt,
    closedBy: ticket.closedBy,
  });
  data.closed = data.closed.slice(0, 1000);
  await saveTickets(data);

  const channel =
    guild.channels.cache.get(ticket.channelId) ||
    (await guild.channels.fetch(ticket.channelId).catch(() => null));
  if (channel?.isTextBased()) {
    await logTicketClosed(guild, { ticket, closedById });
    await sendTicketTranscript(guild, ticket, closedById).catch((error) =>
      console.error("Ticket transcript failed:", error.message),
    );
    await channel.send(`🔒 Ticket closed by <@${closedById}>. Channel will delete in 15s.`);
    setTimeout(() => channel.delete().catch(() => {}), 15_000);
  } else {
    await logTicketClosed(guild, { ticket, closedById });
    await sendTicketTranscript(guild, ticket, closedById).catch(() => {});
  }

  return { ok: true, ticket };
}

export async function findTicketByChannel(channelId) {
  const data = await getTickets();
  return data.open.find((t) => t.channelId === channelId) ?? null;
}

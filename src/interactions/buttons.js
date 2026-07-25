import {
  enterGiveaway,
  refreshGiveawayMessage,
} from "../modules/giveaways/manager.js";
import { openTicket, closeTicket } from "../modules/tickets/manager.js";
import { handleVerifyButton } from "../modules/welcome/handlers.js";
import { requireStaff, isStaff } from "../lib/permissions.js";
import { findTicketByChannel } from "../modules/tickets/manager.js";

export async function handleButton(interaction, client) {
  const [namespace, action, id] = interaction.customId.split(":");

  if (namespace === "giveaway" && action === "enter") {
    const result = await enterGiveaway(id, interaction.user.id, interaction.member);
    if (!result.ok) {
      return interaction.reply({ ephemeral: true, content: result.error });
    }
    await refreshGiveawayMessage(client, result.giveaway);
    return interaction.reply({ ephemeral: true, content: "🎉 You're entered! Good luck." });
  }

  if (namespace === "ticket" && action === "open") {
    // Channel creation can exceed Discord's 3s reply window — defer first.
    await interaction.deferReply({ ephemeral: true });
    const result = await openTicket(
      interaction.guild,
      interaction.member,
      id,
      interaction.channel,
    );
    if (!result.ok) {
      return interaction.editReply(result.error);
    }
    return interaction.editReply(`Ticket opened: ${result.channel}`);
  }

  if (namespace === "ticket" && action === "close") {
    const ticketRecord = await findTicketByChannel(interaction.channelId);
    const canClose =
      isStaff(interaction.member) ||
      ticketRecord?.userId === interaction.user.id;
    if (!canClose) {
      return interaction.reply({ ephemeral: true, content: "Only staff or the ticket owner can close this." });
    }
    await interaction.deferReply({ ephemeral: true });
    const ticket = await closeTicket(interaction.guild, id, interaction.user.id);
    if (!ticket.ok) {
      return interaction.editReply(ticket.error);
    }
    return interaction.editReply("Ticket closing…");
  }

  if (namespace === "verify" && action === "accept") {
    return handleVerifyButton(interaction);
  }
}

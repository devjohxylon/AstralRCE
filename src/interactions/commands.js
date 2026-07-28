import { EmbedBuilder } from "discord.js";
import { getBotStatus } from "../services/discordPublish.js";
import { backfillChannel, syncLatestLeaderboard } from "../services/website.js";
import { config } from "../config.js";
import { requireStaff, isStaff } from "../lib/permissions.js";
import { getCasesForUser } from "../data/store.js";
import {
  warnMember,
  muteMember,
  kickMember,
  banMember,
  setRaidMode,
  lockChannel,
} from "../modules/moderation/actions.js";
import {
  createGiveaway,
  endGiveaway,
  findGiveawayByMessage,
} from "../modules/giveaways/manager.js";
import {
  buildTicketPanelEmbed,
  buildTicketPanelRow,
  closeTicket,
  findTicketByChannel,
} from "../modules/tickets/manager.js";

export async function handleAstralCommands(interaction, client) {
  if (!(await requireStaff(interaction))) return;

  if (interaction.commandName === "astral-status") {
    const status = await getBotStatus(client);
    return interaction.reply({
      ephemeral: true,
      content: [
        `**Bot:** ${status.user}`,
        `**Uptime:** ${status.uptimeSeconds}s`,
        `**Watching:** ${status.watchedChannels.length} channel(s)`,
        `**Website:** ${status.websiteIngestUrl}`,
        `**Auto-mod:** ${config.automod.enabled ? "on" : "off"}`,
      ].join("\n"),
    });
  }

  if (interaction.commandName === "astral-leaderboard") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const ids = await syncLatestLeaderboard(client, { force: true });
      return interaction.editReply(`Synced leaderboard (\`${ids[0]}\`).`);
    } catch (error) {
      return interaction.editReply(`Failed: ${error.message}`);
    }
  }

  if (interaction.commandName === "astral-sync") {
    await interaction.deferReply({ ephemeral: true });
    const key = interaction.options.getString("channel") ?? "leaderboard";
    const map = {
      leaderboard: config.channels.leaderboard,
      kaos_activity: config.channels.kaosActivity,
      announcements: config.channels.announcements,
    };
    const channelId = map[key];
    const channel = client.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return interaction.editReply("Channel not configured.");
    const ids = await backfillChannel(channel, 25);
    return interaction.editReply(`Synced ${ids.length} message(s).`);
  }
}

export async function handleModerationCommands(interaction) {
  if (!(await requireStaff(interaction))) return;

  const user = interaction.options.getUser("user", false);
  const reason = interaction.options.getString("reason") ?? "No reason provided";

  if (interaction.commandName === "warn") {
    const { warnCount } = await warnMember(interaction, user, reason);
    return interaction.reply({
      ephemeral: true,
      content: `⚠️ Warned <@${user.id}> (${warnCount} total warning(s)). Reason: ${reason}`,
    });
  }

  if (interaction.commandName === "mute") {
    const minutes = interaction.options.getInteger("minutes", true);
    await muteMember(interaction, user, minutes, reason);
    return interaction.reply({
      ephemeral: true,
      content: `🔇 Muted <@${user.id}> for ${minutes}m. Reason: ${reason}`,
    });
  }

  if (interaction.commandName === "kick") {
    await kickMember(interaction, user, reason);
    return interaction.reply({ ephemeral: true, content: `👢 Kicked <@${user.id}>.` });
  }

  if (interaction.commandName === "ban") {
    const deleteDays = interaction.options.getInteger("delete_days") ?? 0;
    await banMember(interaction, user, reason, deleteDays);
    return interaction.reply({ ephemeral: true, content: `🔨 Banned <@${user.id}>.` });
  }

  if (interaction.commandName === "purge") {
    const amount = interaction.options.getInteger("amount", true);
    const filterUser = interaction.options.getUser("user");
    await interaction.deferReply({ ephemeral: true });
    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    let toDelete = [...messages.values()].filter((m) => !m.pinned);
    if (filterUser) toDelete = toDelete.filter((m) => m.author.id === filterUser.id);
    toDelete = toDelete.slice(0, amount);
    await interaction.channel.bulkDelete(toDelete, true);
    return interaction.editReply(`Deleted ${toDelete.length} message(s).`);
  }

  if (interaction.commandName === "slowmode") {
    const seconds = interaction.options.getInteger("seconds", true);
    await interaction.channel.setRateLimitPerUser(seconds);
    return interaction.reply({ ephemeral: true, content: `Slowmode set to ${seconds}s.` });
  }

  if (interaction.commandName === "lock") {
    const channel = interaction.options.getChannel("channel") ?? interaction.channel;
    await lockChannel(channel, true);
    return interaction.reply({ ephemeral: true, content: `🔒 Locked ${channel}.` });
  }

  if (interaction.commandName === "unlock") {
    const channel = interaction.options.getChannel("channel") ?? interaction.channel;
    await lockChannel(channel, false);
    return interaction.reply({ ephemeral: true, content: `🔓 Unlocked ${channel}.` });
  }

  if (interaction.commandName === "raidmode") {
    const enabled = interaction.options.getBoolean("enabled", true);
    const count = await setRaidMode(interaction.guild, enabled);
    return interaction.reply({
      ephemeral: true,
      content: enabled ? `🚨 Raid mode ON (${count} channels locked).` : "✅ Raid mode OFF.",
    });
  }

  if (interaction.commandName === "case") {
    const cases = await getCasesForUser(user.id);
    if (cases.length === 0) {
      return interaction.reply({ ephemeral: true, content: "No cases for this user." });
    }
    const lines = cases.slice(0, 10).map(
      (c) => `\`${c.at.slice(0, 10)}\` **${c.action}** — ${c.reason}`,
    );
    return interaction.reply({
      ephemeral: true,
      content: `**Cases for ${user.tag}**\n${lines.join("\n")}`,
    });
  }
}

export async function handleGiveawayCommand(interaction, client) {
  if (!(await requireStaff(interaction))) return;

  const sub = interaction.options.getSubcommand();

  if (sub === "create") {
    const prize = interaction.options.getString("prize", true);
    const minutes = interaction.options.getInteger("minutes", true);
    const winners = interaction.options.getInteger("winners") ?? 1;
    const role = interaction.options.getRole("required_role");
    const grantVip = interaction.options.getBoolean("grant_vip") ?? false;
    const channel = interaction.options.getChannel("channel") ?? interaction.channel;

    const giveaway = await createGiveaway({
      guild: interaction.guild,
      channel,
      prize,
      durationMinutes: minutes,
      winnersCount: winners,
      requiredRoleId: role?.id,
      grantVipRole: grantVip,
      hostId: interaction.user.id,
    });

    const vipNote = giveaway.grantVipRole ? " VIP role will be granted to winners." : "";
    return interaction.reply({
      ephemeral: true,
      content: `🎉 Giveaway started in ${channel}! Message: \`${giveaway.messageId}\`${vipNote}`,
    });
  }

  if (sub === "end" || sub === "reroll") {
    const messageId = interaction.options.getString("message_id", true);
    const giveaway = await findGiveawayByMessage(messageId);
    if (!giveaway) {
      return interaction.reply({ ephemeral: true, content: "Giveaway not found for that message ID." });
    }
    await endGiveaway(client, giveaway.id, { reroll: sub === "reroll" });
    return interaction.reply({
      ephemeral: true,
      content: sub === "reroll" ? "Winners rerolled." : "Giveaway ended.",
    });
  }
}

export async function handleTicketCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "setup") {
    if (!(await requireStaff(interaction))) return;
    await interaction.channel.send({
      embeds: [buildTicketPanelEmbed()],
      components: [buildTicketPanelRow()],
    });
    return interaction.reply({ ephemeral: true, content: "Ticket panel posted." });
  }

  if (sub === "close") {
    const ticket = await findTicketByChannel(interaction.channelId);
    const canClose = ticket
      ? isStaff(interaction.member) || ticket.userId === interaction.user.id
      : isStaff(interaction.member);

    if (!ticket && !canClose) {
      return interaction.reply({ ephemeral: true, content: "This is not a ticket channel." });
    }
    if (ticket && !canClose) {
      return interaction.reply({
        ephemeral: true,
        content: "Only staff or the ticket owner can close this.",
      });
    }

    await interaction.deferReply({ ephemeral: true });
    const result = await closeTicket(
      interaction.guild,
      ticket?.id,
      interaction.user.id,
      { channelId: interaction.channelId },
    );
    if (!result.ok) {
      return interaction.editReply(result.error);
    }
    return interaction.editReply("Closing ticket…");
  }
}

export async function handleCommunityCommands(interaction) {
  if (!(await requireStaff(interaction))) return;

  if (interaction.commandName === "poll") {
    const question = interaction.options.getString("question", true);
    const options = ["option1", "option2", "option3", "option4"]
      .map((key) => interaction.options.getString(key))
      .filter(Boolean);
    const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${question}`)
      .setDescription(options.map((opt, i) => `${emojis[i]} ${opt}`).join("\n\n"))
      .setColor(0x9b59b6);
    const message = await interaction.channel.send({ embeds: [embed] });
    for (let i = 0; i < options.length; i++) {
      await message.react(emojis[i]);
    }
    return interaction.reply({ ephemeral: true, content: "Poll posted." });
  }

  if (interaction.commandName === "announce") {
    const title = interaction.options.getString("title", true);
    const text = interaction.options.getString("message", true);
    const channel = interaction.options.getChannel("channel") ?? interaction.channel;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(text)
      .setColor(0xe67e22)
      .setFooter({ text: "Astral Vanilla+" })
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    return interaction.reply({ ephemeral: true, content: `Announcement sent to ${channel}.` });
  }
}

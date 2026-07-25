import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { getGiveaways, saveGiveaways } from "../../data/store.js";
import { config } from "../../config.js";
import { grantVipToWinners } from "../../lib/giveaway-rewards.js";

export function buildGiveawayEmbed(giveaway) {
  const endsUnix = Math.floor(new Date(giveaway.endsAt).getTime() / 1000);
  const embed = new EmbedBuilder()
    .setTitle("🎉 GIVEAWAY")
    .setColor(0xf1c40f)
    .setDescription(`**Prize:** ${giveaway.prize}`)
    .addFields(
      { name: "Winners", value: `${giveaway.winnersCount}`, inline: true },
      { name: "Entries", value: `${giveaway.entries.length}`, inline: true },
      { name: "Ends", value: `<t:${endsUnix}:R>`, inline: true },
    )
    .setFooter({ text: "Click Enter to join • Astral Bot" })
    .setTimestamp(new Date(giveaway.endsAt));

  if (giveaway.requiredRoleId) {
    embed.addFields({
      name: "Required role",
      value: `<@&${giveaway.requiredRoleId}>`,
      inline: true,
    });
  }

  if (giveaway.grantVipRole) {
    embed.addFields({
      name: "Winner reward",
      value: "VIP Discord role",
      inline: true,
    });
  }

  if (giveaway.ended) {
    embed.setColor(0x95a5a6);
    embed.setDescription(
      `**Prize:** ${giveaway.prize}\n\n**Ended**\nWinners: ${
        giveaway.winnerIds?.length
          ? giveaway.winnerIds.map((id) => `<@${id}>`).join(", ")
          : "No valid entries"
      }`,
    );
  }

  return embed;
}

export function buildGiveawayRow(giveaway) {
  if (giveaway.ended) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${giveaway.id}`)
      .setLabel("Enter")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🎉"),
  );
}

export async function createGiveaway({
  guild,
  channel,
  prize,
  durationMinutes,
  winnersCount,
  requiredRoleId,
  hostId,
  grantVipRole = false,
}) {
  const endsAt = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  const shouldGrantVip =
    grantVipRole || (config.giveaways.autoVip && Boolean(config.roles.vip));

  const giveaway = {
    id: crypto.randomUUID(),
    guildId: guild.id,
    channelId: channel.id,
    messageId: null,
    prize,
    winnersCount: Math.max(1, winnersCount),
    requiredRoleId: requiredRoleId ?? null,
    grantVipRole: shouldGrantVip,
    hostId,
    endsAt,
    entries: [],
    ended: false,
    winnerIds: [],
  };

  const embed = buildGiveawayEmbed(giveaway);
  const row = buildGiveawayRow(giveaway);
  const message = await channel.send({ embeds: [embed], components: row ? [row] : [] });
  giveaway.messageId = message.id;

  const data = await getGiveaways();
  data.active.push(giveaway);
  await saveGiveaways(data);
  return giveaway;
}

export async function enterGiveaway(giveawayId, userId, member) {
  const data = await getGiveaways();
  const giveaway = data.active.find((g) => g.id === giveawayId && !g.ended);
  if (!giveaway) return { ok: false, error: "Giveaway not found or ended." };

  if (giveaway.requiredRoleId && !member.roles.cache.has(giveaway.requiredRoleId)) {
    return { ok: false, error: "You don't have the required role to enter." };
  }

  const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
  if (accountAgeDays < config.giveaways.minAccountDays) {
    return { ok: false, error: `Account must be at least ${config.giveaways.minAccountDays} days old.` };
  }

  const joinHours = (Date.now() - member.joinedTimestamp) / 3_600_000;
  if (joinHours < config.giveaways.minJoinHours) {
    return { ok: false, error: `You must be in the server for ${config.giveaways.minJoinHours}h to enter.` };
  }

  if (giveaway.entries.includes(userId)) {
    return { ok: false, error: "You're already entered." };
  }

  giveaway.entries.push(userId);
  await saveGiveaways(data);
  return { ok: true, giveaway };
}

function pickWinners(entries, count) {
  const pool = [...new Set(entries)];
  const winners = [];
  while (pool.length > 0 && winners.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }
  return winners;
}

export async function endGiveaway(client, giveawayId, { reroll = false } = {}) {
  const data = await getGiveaways();
  const giveaway = data.active.find((g) => g.id === giveawayId);
  if (!giveaway) return null;

  if (!reroll) giveaway.ended = true;
  giveaway.winnerIds = pickWinners(giveaway.entries, giveaway.winnersCount);

  const guild = await client.guilds.fetch(giveaway.guildId).catch(() => null);

  if (guild && giveaway.grantVipRole && giveaway.winnerIds.length > 0) {
    const { granted } = await grantVipToWinners(guild, giveaway.winnerIds, {
      prize: giveaway.prize,
      giveawayId: giveaway.id,
    });
    giveaway.vipGrantedTo = granted;
  }

  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (message) {
      const embed = buildGiveawayEmbed(giveaway);
      await message.edit({ embeds: [embed], components: [] });
      const winnersText =
        giveaway.winnerIds.length > 0
          ? giveaway.winnerIds.map((id) => `<@${id}>`).join(", ")
          : "No valid entries";
      let announce = `🎉 Giveaway ended! **${giveaway.prize}** → ${winnersText}`;
      if (giveaway.vipGrantedTo?.length) {
        announce += `\n💎 VIP role granted to ${giveaway.vipGrantedTo.map((id) => `<@${id}>`).join(", ")}`;
      }
      await channel.send(announce);
    }
  }

  if (!reroll) {
    data.active = data.active.filter((g) => g.id !== giveaway.id);
  }
  await saveGiveaways(data);
  return giveaway;
}

export async function checkExpiredGiveaways(client) {
  const data = await getGiveaways();
  const now = Date.now();
  const expired = data.active.filter((g) => !g.ended && new Date(g.endsAt).getTime() <= now);
  for (const g of expired) {
    await endGiveaway(client, g.id);
  }
}

export async function refreshGiveawayMessage(client, giveaway) {
  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  if (!message) return;
  const embed = buildGiveawayEmbed(giveaway);
  const row = buildGiveawayRow(giveaway);
  await message.edit({ embeds: [embed], components: row ? [row] : [] });
}

export async function findGiveawayByMessage(messageId) {
  const data = await getGiveaways();
  return data.active.find((g) => g.messageId === messageId) ?? null;
}

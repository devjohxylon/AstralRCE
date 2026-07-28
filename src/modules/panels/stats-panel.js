import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { config } from "../../config.js";
import { getLinkByDiscord } from "../rcon/linking.js";
import { getPlayerCard } from "../rcon/stats.js";
import { renderPlayerStatsCard } from "../rcon/player-stats-card.js";

const ACCENT = 0xd7dde6;
const BUTTON_MINE = "stats:mine";

const LOGO_NAME = "astral-logo.png";
const LOGO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../assets/astral-logo.png",
);

function brandIcon(guild) {
  if (config.brand?.logoUrl) return { url: config.brand.logoUrl, attach: false };
  if (existsSync(LOGO_PATH)) return { url: `attachment://${LOGO_NAME}`, attach: true };
  const guildIcon = guild?.iconURL({ size: 256, extension: "png" });
  return { url: guildIcon || null, attach: false };
}

export function buildStatsPanelEmbed(guild) {
  const { url: icon } = brandIcon(guild);
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("Wipe Stats")
    .setDescription(
      "Check your wipe stats in the same style as the leaderboard.\n\n" +
        "1️⃣ Link your account (Link Account panel)\n" +
        "2️⃣ Click **View My Stats** below\n" +
        "3️⃣ Get your personal stats card\n\n" +
        "> Must be linked to your in-game name.",
    )
    .setFooter({
      text: "Astral | Vanilla+",
      iconURL: icon || undefined,
    });

  if (icon) embed.setThumbnail(icon);
  return embed;
}

export function buildStatsPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_MINE)
      .setLabel("View My Stats")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Primary),
  );
}

export async function postStatsPanel(channel) {
  const { attach } = brandIcon(channel.guild);
  return channel.send({
    embeds: [buildStatsPanelEmbed(channel.guild)],
    components: [buildStatsPanelRow()],
    files: attach ? [new AttachmentBuilder(LOGO_PATH, { name: LOGO_NAME })] : [],
  });
}

export async function replyWithPlayerStats(interaction, ign) {
  const card = await getPlayerCard(ign);
  if (!card) {
    const payload = {
      content:
        `No wipe stats for **${ign}** yet.\n` +
        "Stats start counting once they play while the bot is connected.",
    };
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
    return interaction.reply({ ...payload, ephemeral: true });
  }

  const png = await renderPlayerStatsCard(card);
  const file = new AttachmentBuilder(png, { name: "astral-stats.png" });
  const payload = { content: null, files: [file] };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply({ ...payload, ephemeral: true });
}

export async function handleStatsPanelButton(interaction) {
  if (interaction.customId !== BUTTON_MINE) return false;

  await interaction.deferReply({ ephemeral: true });

  const link = await getLinkByDiscord(interaction.user.id);
  if (!link) {
    return interaction.editReply(
      "You're **not linked** yet.\n\n" +
        "Use the **Link Account** panel first, then click **View My Stats**.",
    );
  }

  try {
    return await replyWithPlayerStats(interaction, link.ign);
  } catch (error) {
    return interaction.editReply(`Couldn't render stats: ${error.message}`);
  }
}

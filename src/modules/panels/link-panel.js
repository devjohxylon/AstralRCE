import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { config } from "../../config.js";
import { getLinkByDiscord, linkIgn } from "../rcon/linking.js";
import { syncVipForDiscord } from "../rcon/vip-sync.js";

const ACCENT = 0x57f287;
const BUTTON_OPEN = "link:open";
const BUTTON_STATUS = "link:status";
const MODAL_ID = "link:modal";
const IGN_FIELD = "ign";

const LOGO_NAME = "astral-logo.png";
const LOGO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../assets/astral-logo.png",
);

// Uploading the logo with the message keeps the embed working even when the
// public admin domain isn't reachable.
function brandIcon(guild) {
  if (config.brand?.logoUrl) return { url: config.brand.logoUrl, attach: false };
  if (existsSync(LOGO_PATH)) return { url: `attachment://${LOGO_NAME}`, attach: true };
  const guildIcon = guild?.iconURL({ size: 256, extension: "png" });
  return { url: guildIcon || null, attach: false };
}

export function buildLinkPanelEmbed(guild) {
  const { url: icon } = brandIcon(guild);
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("🔗 Link Your Account")
    .setDescription(
      "Connect your in-game name to Discord.\n\n" +
        "1️⃣ Click **Link Account** below\n" +
        "2️⃣ Enter your **exact** in-game username\n" +
        "3️⃣ Confirm — you're done!\n\n" +
        "> You can only link once.\n" +
        "> Contact an admin if you need help.",
    )
    .setFooter({
      text: "Astral | Vanilla+",
      iconURL: icon || undefined,
    });

  if (icon) embed.setThumbnail(icon);
  return embed;
}

export function buildLinkPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_OPEN)
      .setLabel("Link Account")
      .setEmoji("🔗")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(BUTTON_STATUS)
      .setLabel("Check Status")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),
  );
}

export async function postLinkPanel(channel) {
  const { attach } = brandIcon(channel.guild);
  return channel.send({
    embeds: [buildLinkPanelEmbed(channel.guild)],
    components: [buildLinkPanelRow()],
    files: attach ? [new AttachmentBuilder(LOGO_PATH, { name: LOGO_NAME })] : [],
  });
}

export async function handleLinkPanelButton(interaction) {
  if (interaction.customId === BUTTON_STATUS) {
    const link = await getLinkByDiscord(interaction.user.id);
    if (!link) {
      return interaction.reply({
        ephemeral: true,
        content:
          "You're **not linked** yet.\n\n" +
          "Join the server, press **Link Account**, and enter your exact IGN.",
      });
    }
    const when = Math.floor(new Date(link.linkedAt).getTime() / 1000);
    return interaction.reply({
      ephemeral: true,
      content:
        `You're linked as **${link.ign}**\n` +
        `Linked <t:${when}:R>` +
        (link.forced ? " · *(staff force-link)*" : ""),
    });
  }

  if (interaction.customId !== BUTTON_OPEN) return false;

  const existing = await getLinkByDiscord(interaction.user.id);
  if (existing) {
    return interaction.reply({
      ephemeral: true,
      content:
        `You're already linked as **${existing.ign}**.\n` +
        "Need a change? Contact staff.",
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle("Link Your Account");

  const ignInput = new TextInputBuilder()
    .setCustomId(IGN_FIELD)
    .setLabel("Exact in-game name")
    .setPlaceholder("Must match your name on the server")
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(32)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(ignInput));
  await interaction.showModal(modal);
  return true;
}

export async function handleLinkModal(interaction) {
  if (interaction.customId !== MODAL_ID) return false;

  const ign = interaction.fields.getTextInputValue(IGN_FIELD).trim();
  await interaction.deferReply({ ephemeral: true });

  const result = await linkIgn(interaction.user.id, ign);
  if (!result.ok) {
    await interaction.editReply({
      content:
        `❌ **Couldn't link**\n${result.error}\n\n` +
        "Make sure you're online and the name matches exactly.",
    });
    return true;
  }
  if (result.already) {
    await interaction.editReply(`Already linked as **${result.ign}**.`);
    return true;
  }

  await syncVipForDiscord(interaction.user.id, interaction.member).catch(() => {});
  await interaction.editReply({
    content:
      `✅ **Linked as \`${result.ign}\`**\n\n` +
      "You can now use `/home`, `/warp`, and `/tpr`.\n" +
      "VIP players get their kit synced automatically.",
  });
  return true;
}

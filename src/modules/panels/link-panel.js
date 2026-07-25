import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { config } from "../../config.js";
import { linkIgn } from "../rcon/linking.js";
import { syncVipForDiscord } from "../rcon/vip-sync.js";

const ACCENT = 0x57f287;
const BUTTON_ID = "link:open";
const MODAL_ID = "link:modal";
const IGN_FIELD = "ign";

function brandIcon(guild) {
  return (
    config.brand?.logoUrl ||
    guild?.iconURL({ size: 128, extension: "png" }) ||
    null
  );
}

export function buildLinkPanelEmbed(guild) {
  const icon = brandIcon(guild);
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle("🔗 Link Your Account")
    .setDescription(
      "Connect your in-game name to Discord. This unlocks homes, warps, teleports, and VIP sync.\n\n" +
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
      .setCustomId(BUTTON_ID)
      .setLabel("Link Account")
      .setEmoji("🔗")
      .setStyle(ButtonStyle.Success),
  );
}

export async function postLinkPanel(channel) {
  return channel.send({
    embeds: [buildLinkPanelEmbed(channel.guild)],
    components: [buildLinkPanelRow()],
  });
}

export async function handleLinkPanelButton(interaction) {
  if (interaction.customId !== BUTTON_ID) return false;

  const modal = new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle("Link Your Account");

  const ignInput = new TextInputBuilder()
    .setCustomId(IGN_FIELD)
    .setLabel("In-game username")
    .setPlaceholder("Your exact Rust IGN")
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
    await interaction.editReply(result.error);
    return true;
  }
  if (result.already) {
    await interaction.editReply(`Already linked as **${result.ign}**.`);
    return true;
  }

  await syncVipForDiscord(interaction.user.id, interaction.member).catch(() => {});
  await interaction.editReply(
    `Linked as **${result.ign}**. You can use \`/home\`, \`/warp\`, and \`/tpr\` now.`,
  );
  return true;
}

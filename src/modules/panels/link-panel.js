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
import { getLinkByDiscord, linkIgn } from "../rcon/linking.js";
import { syncVipForDiscord } from "../rcon/vip-sync.js";

const ACCENT = 0x57f287;
const BUTTON_OPEN = "link:open";
const BUTTON_STATUS = "link:status";
const MODAL_ID = "link:modal";
const IGN_FIELD = "ign";

function brandIcon(guild) {
  return (
    config.brand?.logoUrl ||
    guild?.iconURL({ size: 256, extension: "png" }) ||
    null
  );
}

export function buildLinkPanelEmbed(guild) {
  const icon = brandIcon(guild);
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setAuthor({
      name: "Astral Vanilla+",
      iconURL: icon || undefined,
    })
    .setTitle("Link Your Account")
    .setDescription(
      "Connect your **in-game name** to Discord so the bot knows who you are on the server.",
    )
    .addFields(
      {
        name: "How to link",
        value:
          "1️⃣ Join **Astral Vanilla+** and stay online\n" +
          "2️⃣ Press **Link Account** below\n" +
          "3️⃣ Type your **exact** in-game name\n" +
          "4️⃣ Confirm — you're linked",
      },
      {
        name: "Requirements",
        value:
          "• You must be **online** when linking\n" +
          "• Name must match **exactly** (caps + spelling)\n" +
          "• One Discord account ↔ one IGN",
        inline: true,
      },
      {
        name: "What you unlock",
        value:
          "• `/home` set & teleport\n" +
          "• `/warp` public warps\n" +
          "• `/tpr` player teleports\n" +
          "• VIP kit sync (if VIP)",
        inline: true,
      },
      {
        name: "Important",
        value:
          "> Linking is **permanent** unless staff unlinks you.\n" +
          "> Wrong name? Ask staff before trying again.\n" +
          "> Stuck? Open a support ticket.",
      },
    )
    .setFooter({
      text: "Astral | Vanilla+  •  Account Linking",
      iconURL: icon || undefined,
    })
    .setTimestamp();

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
  return channel.send({
    embeds: [buildLinkPanelEmbed(channel.guild)],
    components: [buildLinkPanelRow()],
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

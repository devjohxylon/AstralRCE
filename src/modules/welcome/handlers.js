import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { config } from "../../config.js";

export async function handleMemberJoin(member) {
  const welcomeId = config.channels.welcome;
  if (!welcomeId) return;

  const channel = member.guild.channels.cache.get(welcomeId);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(`Welcome to ${member.guild.name}`)
    .setColor(0xe67e22)
    .setDescription(
      `Hey <@${member.id}> — welcome to **Astral Vanilla+**.\n\n` +
        "🔗 **Store:** https://acesrust.com\n" +
        "🏆 **Leaderboard:** https://acesrust.com/leaderboard\n" +
        "📅 **Wipes:** https://acesrust.com/wipes\n\n" +
        "Read the rules and verify below to unlock the full server.",
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 128 }));

  const components = [];
  if (config.roles.verified) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("verify:accept")
          .setLabel("I agree to the rules")
          .setStyle(ButtonStyle.Success),
      ),
    );
  }

  await channel.send({ embeds: [embed], components }).catch(() => {});

  if (config.roles.autoMember) {
    await member.roles.add(config.roles.autoMember).catch(() => {});
  }
}

export async function handleVerifyButton(interaction) {
  const roleId = config.roles.verified;
  if (!roleId) {
    return interaction.reply({ content: "Verification role is not configured.", ephemeral: true });
  }

  const member = interaction.member;
  if (member.roles.cache.has(roleId)) {
    return interaction.reply({ content: "You're already verified.", ephemeral: true });
  }

  await member.roles.add(roleId);
  return interaction.reply({
    content: "✅ Verified! You now have access to the server. Have fun and good luck on wipe.",
    ephemeral: true,
  });
}

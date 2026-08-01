import { config } from "../config.js";
import { requireStaff } from "../lib/permissions.js";
import {
  forceLink,
  getLinkByDiscord,
  linkIgn,
  unlinkDiscord,
} from "../modules/rcon/linking.js";
import {
  deleteHome,
  deleteWarp,
  goHome,
  goWarp,
  listHomes,
  listWarps,
  requestTeleport,
  respondTeleport,
  setHome,
  setWarp,
} from "../modules/rcon/teleports.js";
import {
  addAutoMessage,
  listAutoMessages,
  removeAutoMessage,
  toggleAutoMessage,
} from "../modules/rcon/automessages.js";
import { syncVipForDiscord } from "../modules/rcon/vip-sync.js";
import { postLinkPanel } from "../modules/panels/link-panel.js";
import {
  getVipClaimStatus,
  clearVipPostWipeLock,
} from "../modules/rcon/vip-claims.js";

async function reply(interaction, content, ephemeral = true) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(content);
  }
  return interaction.reply({ content, ephemeral });
}

export async function handleLinkCommand(interaction) {
  const sub = interaction.options.getSubcommand(false);

  if (!sub || sub === "start" || sub === "claim") {
    const ign = interaction.options.getString("player", true);
    await interaction.deferReply({ ephemeral: true });
    const result = await linkIgn(interaction.user.id, ign, {
      member: interaction.member,
    });
    if (!result.ok) return interaction.editReply(result.error);
    if (result.already) {
      return interaction.editReply(`Already linked as **${result.ign}**.`);
    }
    await syncVipForDiscord(interaction.user.id, interaction.member).catch(() => {});
    return interaction.editReply(`✅ Linked as **${result.ign}**`);
  }

  if (sub === "status") {
    const link = await getLinkByDiscord(interaction.user.id);
    if (!link) {
      return reply(interaction, "Not linked. Use the **Link Account** panel or `/link start`.");
    }
    return reply(
      interaction,
      `Linked as **${link.ign}** (since ${new Date(link.linkedAt).toLocaleDateString()}).`,
    );
  }

  if (sub === "unlink") {
    const result = await unlinkDiscord(interaction.user.id, {
      member: interaction.member,
    });
    if (!result.ok) return reply(interaction, result.error);
    return reply(interaction, `Unlinked from **${result.ign}**.`);
  }

  if (sub === "panel") {
    if (!(await requireStaff(interaction))) return;
    await postLinkPanel(interaction.channel);
    return reply(interaction, "Link panel posted.");
  }

  if (sub === "force") {
    if (!(await requireStaff(interaction))) return;
    const user = interaction.options.getUser("user", true);
    const ign = interaction.options.getString("player", true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const result = await forceLink(user.id, ign, { member });
    if (member) await syncVipForDiscord(user.id, member, { force: true }).catch(() => {});
    return reply(interaction, `Force-linked <@${user.id}> → **${result.ign}**.`);
  }

  if (sub === "syncrole") {
    if (!(await requireStaff(interaction))) return;
    await interaction.deferReply({ ephemeral: true });
    const result = await backfillLinkedRoles();
    if (!result.ok) return interaction.editReply(result.error);
    return interaction.editReply(
      `Linked role sync complete.\n` +
        `• **${result.granted}** granted\n` +
        `• **${result.already}** already had it\n` +
        `• **${result.missing}** not in the Discord server\n` +
        `• **${result.failed}** failed` +
        (result.errors?.length ? `\n\n${result.errors.join("\n")}` : ""),
    );
  }
}

export async function handleHomeCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "set") {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.options.getString("name") ?? "home";
    try {
      const result = await setHome(interaction.user.id, interaction.member, name);
      if (!result.ok) return interaction.editReply(result.error);
      return interaction.editReply(
        `Home \`${result.name}\` set at \`${result.pos.x.toFixed(1)}, ${result.pos.y.toFixed(1)}, ${result.pos.z.toFixed(1)}\`.`,
      );
    } catch (error) {
      return interaction.editReply(`Failed: ${error.message}`);
    }
  }

  if (sub === "go") {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.options.getString("name") ?? "home";
    try {
      const result = await goHome(
        interaction.user.id,
        interaction.member,
        name,
        (msg) => interaction.editReply(msg),
      );
      if (!result.ok) return interaction.editReply(result.error);
      return interaction.editReply(`Teleported to ${result.label}.`);
    } catch (error) {
      return interaction.editReply(`Failed: ${error.message}`);
    }
  }

  if (sub === "list") {
    const result = await listHomes(interaction.user.id);
    if (!result.homes.length) {
      return reply(interaction, "No homes set. Stand where you want one and run `/home set`.");
    }
    const lines = result.homes.map(
      (h) => `• \`${h.name}\` — ${h.x.toFixed(0)}, ${h.y.toFixed(0)}, ${h.z.toFixed(0)}`,
    );
    return reply(interaction, `**Your homes**\n${lines.join("\n")}`);
  }

  if (sub === "delete") {
    const name = interaction.options.getString("name") ?? "home";
    const result = await deleteHome(interaction.user.id, name);
    if (!result.ok) return reply(interaction, result.error);
    return reply(interaction, `Deleted home \`${result.name}\`.`);
  }
}

export async function handleWarpCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "go") {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.options.getString("name", true);
    try {
      const result = await goWarp(
        interaction.user.id,
        interaction.member,
        name,
        (msg) => interaction.editReply(msg),
      );
      if (!result.ok) return interaction.editReply(result.error);
      return interaction.editReply(`Teleported to ${result.label}.`);
    } catch (error) {
      return interaction.editReply(`Failed: ${error.message}`);
    }
  }

  if (sub === "list") {
    const warps = await listWarps();
    if (!warps.length) return reply(interaction, "No warps yet.");
    return reply(interaction, `**Warps:** ${warps.map((w) => `\`${w}\``).join(", ")}`);
  }

  if (sub === "set" || sub === "delete") {
    if (!(await requireStaff(interaction))) return;
    await interaction.deferReply({ ephemeral: true });

    if (sub === "set") {
      const name = interaction.options.getString("name", true);
      try {
        const result = await setWarp(name, interaction.user.id);
        if (!result.ok) return interaction.editReply(result.error);
        return interaction.editReply(`Warp \`${result.name}\` saved.`);
      } catch (error) {
        return interaction.editReply(`Failed: ${error.message}`);
      }
    }

    const name = interaction.options.getString("name", true);
    const result = await deleteWarp(name);
    if (!result.ok) return interaction.editReply(result.error);
    return interaction.editReply(`Deleted warp \`${result.name}\`.`);
  }
}

export async function handleTprCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const player = interaction.options.getString("player", true);
  const result = await requestTeleport(interaction.user.id, player);
  if (!result.ok) return interaction.editReply(result.error);

  const mention = result.request.toDiscordId
    ? `<@${result.request.toDiscordId}>`
    : `**${result.request.toIgn}**`;

  if (result.request.toDiscordId) {
    const user = await interaction.client.users
      .fetch(result.request.toDiscordId)
      .catch(() => null);
    await user
      ?.send(
        `**${result.request.fromIgn}** wants to teleport to you. Accept with \`/tpa\` or deny with \`/tpd\` (expires in ${config.teleports.tprTimeoutSeconds}s).`,
      )
      .catch(() => {});
  }

  return interaction.editReply(
    `Teleport request sent to ${mention}. They have ${config.teleports.tprTimeoutSeconds}s to accept.`,
  );
}

export async function handleTpaCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await respondTeleport(
      interaction.user.id,
      true,
      interaction.member,
      (msg) => interaction.editReply(msg),
    );
    if (!result.ok) return interaction.editReply(result.error);
    return interaction.editReply(`Accepted — **${result.fromIgn}** is teleporting to you.`);
  } catch (error) {
    return interaction.editReply(`Failed: ${error.message}`);
  }
}

export async function handleTpdCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const result = await respondTeleport(interaction.user.id, false, interaction.member);
  if (!result.ok) return interaction.editReply(result.error);
  return interaction.editReply(`Denied teleport from **${result.fromIgn}**.`);
}

export async function handleAutoMessageCommand(interaction) {
  if (!(await requireStaff(interaction))) return;
  const sub = interaction.options.getSubcommand();

  if (sub === "add") {
    const text = interaction.options.getString("text", true);
    const minutes = interaction.options.getInteger("minutes") ?? 15;
    const message = await addAutoMessage(text, minutes);
    return reply(
      interaction,
      `Auto-message \`${message.id}\` added (every ${message.intervalMinutes}m):\n> ${message.text}`,
    );
  }

  if (sub === "list") {
    const messages = await listAutoMessages();
    if (!messages.length) return reply(interaction, "No auto-messages.");
    const body = messages
      .map(
        (m) =>
          `• \`${m.id}\` ${m.enabled ? "✅" : "⏸"} every ${m.intervalMinutes}m — ${m.text}`,
      )
      .join("\n");
    return reply(interaction, body);
  }

  if (sub === "remove") {
    const id = interaction.options.getString("id", true);
    const result = await removeAutoMessage(id);
    if (!result.ok) return reply(interaction, result.error);
    return reply(interaction, `Removed auto-message \`${id}\`.`);
  }

  if (sub === "toggle") {
    const id = interaction.options.getString("id", true);
    const enabled = interaction.options.getBoolean("enabled", true);
    const result = await toggleAutoMessage(id, enabled);
    if (!result.ok) return reply(interaction, result.error);
    return reply(interaction, `Auto-message \`${id}\` is now ${enabled ? "on" : "off"}.`);
  }
}

export async function handleVipCommand(interaction) {
  if (!(await requireStaff(interaction))) return;
  const sub = interaction.options.getSubcommand();

  if (sub === "status") {
    const lockHours = Number(config.vip.postWipeLockHours) || 4;
    const status = await getVipClaimStatus(lockHours);

    const lines = [
      `**VIP Claim Status**`,
      `Wipe ID: \`${status.wipeId || "not set"}\``,
      `Total claims this wipe: **${status.totalClaims}**`,
      ``,
    ];

    if (status.lockActive) {
      const hours = Math.floor(status.lockRemainingSeconds / 3600);
      const minutes = Math.ceil((status.lockRemainingSeconds % 3600) / 60);
      lines.push(
        `🔒 **Post-wipe lock is ACTIVE**`,
        `Players cannot claim VIP for **${hours}h ${minutes}m**`,
        `Lock started: <t:${Math.floor(new Date(status.wipeStartedAt).getTime() / 1000)}:R>`,
        ``,
        `Use \`/vip unlock\` to clear the lock early.`,
      );
    } else {
      lines.push(
        `✅ **Claims are OPEN**`,
        `Players can claim VIP with quick chat: \`${config.vip.claimPhrase || "i need water"}\``,
      );
    }

    return reply(interaction, lines.join("\n"));
  }

  if (sub === "unlock") {
    const result = await clearVipPostWipeLock();
    if (!result.ok) return reply(interaction, result.error);

    return reply(
      interaction,
      `✅ **Post-wipe lock cleared**\nPlayers can now claim VIP immediately.\nWipe ID: \`${result.wipeId || "none"}\``,
    );
  }
}

import { EmbedBuilder } from "discord.js";
import { requireStaff } from "../lib/permissions.js";
import { sendModLog } from "../lib/modlog.js";
import {
  getOnlinePlayers,
  getServerInfo,
  sendGameCommand,
} from "../modules/rcon/client.js";
import { getRconStatus } from "../modules/rcon/client.js";
import { pushLeaderboardToWebsite, buildLeaderboardAttachment } from "../modules/rcon/index.js";
import {
  formatPlaytime,
  getLeaderboard,
  getPlayerCard,
  resetStats,
} from "../modules/rcon/stats.js";

const CATEGORY_LABELS = {
  kills: "Top Kills",
  deaths: "Most Deaths",
  kd: "Best K/D",
  playtime: "Most Playtime",
};

function offlineNotice() {
  const status = getRconStatus();
  if (!status.enabled) {
    return "RCON isn't configured yet. Add `RCON_HOST`, `RCON_PORT` and `RCON_PASSWORD` to `.env`.";
  }
  return `Not connected to the Rust server${status.lastError ? ` — ${status.lastError}` : ""}.`;
}

function formatUptime(seconds) {
  if (!seconds) return "unknown";
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  return days ? `${days}d ${hours % 24}h` : `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export async function handleServerInfoCommand(interaction) {
  const info = getServerInfo();
  if (!info) {
    return interaction.reply({ ephemeral: true, content: offlineNotice() });
  }

  const embed = new EmbedBuilder()
    .setTitle(info.Hostname ?? "Astral Vanilla+")
    .setColor(0x2ecc71)
    .addFields(
      {
        name: "Players",
        value: `${info.Players ?? 0}/${info.MaxPlayers ?? "?"}${info.Queued ? ` (+${info.Queued} queued)` : ""}`,
        inline: true,
      },
      { name: "Map", value: String(info.Map ?? "Procedural"), inline: true },
      { name: "In-game time", value: String(info.GameTime ?? "?"), inline: true },
      { name: "Uptime", value: formatUptime(info.Uptime), inline: true },
      { name: "FPS", value: String(info.Framerate ?? "?"), inline: true },
      { name: "Entities", value: String(info.EntityCount ?? "?"), inline: true },
    )
    .setTimestamp();

  if (info.Restarting) embed.setFooter({ text: "⚠️ Server is restarting" });

  return interaction.reply({ embeds: [embed] });
}

export async function handlePlayersCommand(interaction) {
  const players = getOnlinePlayers();
  if (!players.length) {
    const info = getServerInfo();
    return interaction.reply({
      ephemeral: true,
      content: info ? "Nobody is online right now." : offlineNotice(),
    });
  }

  const names = players
    .map((p) => p.ign)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");

  const embed = new EmbedBuilder()
    .setTitle(`Online players (${players.length})`)
    .setDescription(names.slice(0, 4000))
    .setColor(0x3498db)
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

export async function handleStatsCommand(interaction) {
  const name = interaction.options.getString("player", true);
  const card = await getPlayerCard(name);

  if (!card) {
    return interaction.reply({
      ephemeral: true,
      content: `No tracked stats for \`${name}\` yet. Stats start counting once they play while the bot is connected.`,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${card.name}`)
    .setColor(0x9b59b6)
    .addFields(
      { name: "Kills", value: String(card.kills), inline: true },
      { name: "Deaths", value: String(card.deaths), inline: true },
      { name: "K/D", value: card.kd, inline: true },
      { name: "NPC kills", value: String(card.npcKills), inline: true },
      { name: "Suicides", value: String(card.suicides), inline: true },
      { name: "Playtime", value: formatPlaytime(card.playtimeMs), inline: true },
    )
    .setFooter({ text: `Last seen ${new Date(card.lastSeen).toLocaleString()}` });

  return interaction.reply({ embeds: [embed] });
}

export async function handleLeaderboardCommand(interaction) {
  await interaction.deferReply();

  try {
    const file = await buildLeaderboardAttachment();
    return interaction.editReply({
      content: null,
      files: [file],
    });
  } catch (error) {
    // Fallback to text embed if image render fails
    const category = interaction.options.getString("category") ?? "kills";
    const rows = await getLeaderboard(category, 10);
    if (!rows.length) {
      return interaction.editReply(
        "No stats tracked yet — the leaderboard fills up as players join and fight.",
      );
    }
    const medals = ["🥇", "🥈", "🥉"];
    const body = rows
      .map((row) => `${medals[row.rank - 1] ?? `\`#${row.rank}\``} **${row.name}** — ${row.value}`)
      .join("\n");
    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${CATEGORY_LABELS[category] ?? "Leaderboard"}`)
      .setDescription(body)
      .setColor(0xf1c40f)
      .setFooter({ text: `Astral Vanilla+ • image render failed: ${error.message}` })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  }
}

export async function handleRconCommand(interaction) {
  if (!(await requireStaff(interaction))) return;

  const sub = interaction.options.getSubcommand();

  if (sub === "resetstats") {
    await interaction.deferReply({ ephemeral: true });
    const label = interaction.options.getString("label");
    const data = await resetStats(label);
    await sendModLog(interaction.guild, {
      title: "Leaderboard stats reset",
      moderatorId: interaction.user.id,
      reason: `Wipe label: ${data.wipe}`,
    });
    return interaction.editReply(`Stats wiped. Now tracking wipe \`${data.wipe}\`.`);
  }

  if (sub === "pushstats") {
    await interaction.deferReply({ ephemeral: true });
    const result = await pushLeaderboardToWebsite().catch((error) => ({ error: error.message }));
    const { publishLeaderboardToDiscord } = await import("../modules/rcon/leaderboard-publish.js");
    const discord = await publishLeaderboardToDiscord(interaction.client).catch((error) => ({
      error: error.message,
    }));
    if (!result && discord?.error) {
      return interaction.editReply(`Failed: ${discord.error}`);
    }
    if (result?.error) return interaction.editReply(`Website: ${result.error}`);
    const parts = [];
    if (result) parts.push(`website ${result.leaderboards.length} board(s)`);
    if (discord && !discord.error) parts.push("Discord image updated");
    if (discord?.error) parts.push(`Discord: ${discord.error}`);
    if (!parts.length) return interaction.editReply("No stats to push yet.");
    return interaction.editReply(`Pushed: ${parts.join(" · ")}`);
  }

  if (!getRconStatus().connected) {
    return interaction.reply({ ephemeral: true, content: offlineNotice() });
  }

  await interaction.deferReply({ ephemeral: true });

  const player = interaction.options.getString("player");
  const reason = interaction.options.getString("reason") ?? "No reason given";

  let command;
  let summary;

  if (sub === "say") {
    const message = interaction.options.getString("message", true);
    command = `say <color=#00ffcc>[Astral]</color> ${message}`;
    summary = `Broadcast: ${message}`;
  } else if (sub === "console") {
    command = interaction.options.getString("command", true);
    summary = `Console: \`${command}\``;
  } else if (sub === "kick") {
    command = `kick "${player}" "${reason}"`;
    summary = `Kicked \`${player}\` — ${reason}`;
  } else if (sub === "ban") {
    command = `ban "${player}" "${reason}"`;
    summary = `Banned \`${player}\` — ${reason}`;
  } else if (sub === "unban") {
    command = `unban "${player}"`;
    summary = `Unbanned \`${player}\``;
  } else if (sub === "give") {
    const item = interaction.options.getString("item", true);
    const amount = interaction.options.getInteger("amount") ?? 1;
    command = `inventory.giveto "${player}" "${item}" ${amount}`;
    summary = `Gave \`${amount}x ${item}\` to \`${player}\``;
  } else {
    return interaction.editReply("Unknown subcommand.");
  }

  try {
    const response = await sendGameCommand(command);

    if (sub === "ban" && player) {
      const { upsertActiveBan } = await import("../modules/bans/manager.js");
      await upsertActiveBan({
        ign: player,
        reason,
        admin: interaction.user.username,
        source: "discord",
      }).catch(() => {});
    } else if (sub === "unban" && player) {
      const { unbanPlayer } = await import("../modules/bans/manager.js");
      await unbanPlayer(player, interaction.user.username, "Unbanned via Discord").catch(() => {});
    }

    await sendModLog(interaction.guild, {
      title: "RCON command",
      moderatorId: interaction.user.id,
      description: summary,
    });

    const output = String(response ?? "").trim();
    return interaction.editReply(
      output ? `${summary}\n\`\`\`\n${output.slice(0, 1800)}\n\`\`\`` : `${summary} ✅`,
    );
  } catch (error) {
    return interaction.editReply(`RCON command failed: ${error.message}`);
  }
}

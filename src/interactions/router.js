import {
  handleAstralCommands,
  handleCommunityCommands,
  handleGiveawayCommand,
  handleModerationCommands,
  handleTicketCommand,
} from "./commands.js";
import { handleButton } from "./buttons.js";
import {
  handleLeaderboardCommand,
  handlePlayersCommand,
  handleRconCommand,
  handleServerInfoCommand,
  handleStatsCommand,
} from "./rcon-commands.js";
import {
  handleAutoMessageCommand,
  handleHomeCommand,
  handleLinkAdminCommand,
  handleLinkCommand,
  handleTpaCommand,
  handleTpdCommand,
  handleTprCommand,
  handleVipCommand,
  handleWarpCommand,
} from "./player-commands.js";
import { handleLinkModal } from "../modules/panels/link-panel.js";
import { isCommandEnabled } from "../modules/admin/command-settings.js";

const MOD_COMMANDS = new Set([
  "warn",
  "mute",
  "kick",
  "ban",
  "purge",
  "slowmode",
  "lock",
  "unlock",
  "raidmode",
  "case",
]);

const ASTRAL_COMMANDS = new Set(["astral-status", "astral-leaderboard", "astral-sync"]);

const PLAYER_COMMANDS = {
  link: handleLinkCommand,
  linkadmin: handleLinkAdminCommand,
  home: handleHomeCommand,
  warp: handleWarpCommand,
  tpr: handleTprCommand,
  tpa: handleTpaCommand,
  tpd: handleTpdCommand,
  automessage: handleAutoMessageCommand,
  vip: handleVipCommand,
};

async function replyDisabled(interaction) {
  const msg = {
    content: `\`/${interaction.commandName}\` is disabled in the admin panel.`,
    ephemeral: true,
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(msg).catch(() => {});
  } else {
    await interaction.reply(msg).catch(() => {});
  }
}

export function attachInteractionRouter(client) {
  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        const name = interaction.commandName;

        if (!isCommandEnabled(name)) {
          return await replyDisabled(interaction);
        }

        if (name === "server") return await handleServerInfoCommand(interaction);
        if (name === "players") return await handlePlayersCommand(interaction);
        if (name === "stats") return await handleStatsCommand(interaction);
        if (name === "leaderboard") return await handleLeaderboardCommand(interaction);
        if (name === "rcon") return await handleRconCommand(interaction);
        if (PLAYER_COMMANDS[name]) return await PLAYER_COMMANDS[name](interaction);

        if (ASTRAL_COMMANDS.has(name)) return await handleAstralCommands(interaction, client);
        if (MOD_COMMANDS.has(name)) return await handleModerationCommands(interaction);
        if (name === "giveaway") return await handleGiveawayCommand(interaction, client);
        if (name === "ticket") return await handleTicketCommand(interaction);
        if (name === "poll" || name === "announce") return await handleCommunityCommands(interaction);
      }

      if (interaction.isButton()) {
        return await handleButton(interaction, client);
      }

      if (interaction.isModalSubmit()) {
        if (await handleLinkModal(interaction)) return;
      }
    } catch (error) {
      console.error("Interaction error:", error);
      const reply = { content: `Error: ${error.message}`, ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  });
}

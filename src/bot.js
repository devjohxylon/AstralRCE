import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "./config.js";
import { relayDiscordMessage, syncServerPop } from "./services/website.js";
import { createWebhookServer } from "./server/webhook.js";
import { attachInteractionRouter } from "./interactions/router.js";
import { runAutomod, trackMemberJoin } from "./modules/automod/engine.js";
import { triggerRaidAlert } from "./modules/moderation/actions.js";
import { handleMemberJoin } from "./modules/welcome/handlers.js";
import { checkExpiredGiveaways } from "./modules/giveaways/manager.js";
import { relayDiscordToGame, shutdownRcon, startRcon } from "./modules/rcon/index.js";
import { isRconEnabled } from "./modules/rcon/client.js";
import { handleVipRoleChange } from "./modules/rcon/vip-sync.js";
import { loadChannelOverrides } from "./modules/admin/channel-settings.js";
import { assertDataPersistence } from "./data/store.js";

export function createBotClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel, Partials.GuildMember],
  });

  client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Auto-mod: ${config.automod.enabled ? "ON" : "OFF"}`);

    await assertDataPersistence().catch((e) =>
      console.error("Data persistence check failed:", e.message),
    );

    await loadChannelOverrides().catch((e) =>
      console.error("Channel overrides failed:", e.message),
    );
    console.log(`Watching ${config.channels.watch.size} relay channel(s)`);

    // With RCON connected we get live player counts straight from the game,
    // so the KAOS voice-channel scrape is only a fallback.
    if (config.channels.pop && !isRconEnabled()) {
      syncServerPop(client, { force: true }).catch((e) =>
        console.error("Initial pop sync failed:", e.message),
      );
      setInterval(() => syncServerPop(client, { silent: true }).catch(() => {}), config.server.pollMs);
    }

    setInterval(() => checkExpiredGiveaways(client).catch(() => {}), 30_000);

    startRcon(client).catch((error) => console.error("RCON startup failed:", error.message));
  });

  client.on("channelUpdate", async (oldChannel, newChannel) => {
    if (!config.channels.pop || newChannel.id !== config.channels.pop) return;
    if (oldChannel?.name === newChannel?.name) return;
    try {
      await syncServerPop(client);
    } catch (error) {
      console.error("Pop sync failed:", error.message);
    }
  });

  client.on("guildMemberAdd", async (member) => {
    try {
      await handleMemberJoin(member);
      const joinCount = trackMemberJoin();
      if (joinCount >= config.automod.raidJoinThreshold) {
        await triggerRaidAlert(member.guild, joinCount);
      }
    } catch (error) {
      console.error("Member join handler failed:", error.message);
    }
  });

  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
      const vipId = config.roles.vip;
      if (!vipId) return;
      const had = oldMember.roles.cache.has(vipId);
      const has = newMember.roles.cache.has(vipId);
      if (had === has) return;
      await handleVipRoleChange(newMember, has);
    } catch (error) {
      console.error("VIP role sync failed:", error.message);
    }
  });

  client.on("messageCreate", async (message) => {
    try {
      await runAutomod(message);
      await relayDiscordToGame(message);
      await relayDiscordMessage(message);
    } catch (error) {
      console.error(`Message handler failed ${message.id}:`, error.message);
    }
  });

  client.on("messageUpdate", async (_old, newMessage) => {
    try {
      if (newMessage.partial) await newMessage.fetch();
      await runAutomod(newMessage);
      await relayDiscordMessage(newMessage);
    } catch (error) {
      console.error(`Message update failed ${newMessage.id}:`, error.message);
    }
  });

  attachInteractionRouter(client);

  return client;
}

export async function startBot() {
  const client = createBotClient();
  const app = createWebhookServer(client);

  // Keep the bot alive on stray Discord API errors (expired interactions, etc.)
  client.on("error", (error) => {
    console.error("Discord client error:", error.message);
  });
  process.on("unhandledRejection", (error) => {
    console.error("Unhandled rejection:", error?.message ?? error);
  });

  // Flush buffered killfeed lines and playtime before exiting
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await shutdownRcon();
      client.destroy();
      process.exit(0);
    });
  }

  await client.login(config.discord.token);

  app.listen(config.webhook.port, "0.0.0.0", () => {
    console.log(`Webhook server listening on port ${config.webhook.port}`);
    const panelUrl =
      config.adminPanel.publicUrl?.replace(/\/$/, "") ||
      `http://localhost:${config.webhook.port}`;
    console.log(`Admin panel: ${panelUrl}/admin`);
  });

  return client;
}

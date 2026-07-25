import { Client, GatewayIntentBits } from "discord.js";
import { config } from "../src/config.js";
import {
  describeMessageForDebug,
  extractLeaderboardImages,
  isLikelyKaosLeaderboardPost,
} from "../src/utils/leaderboardParser.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

async function ensureFullMessage(message) {
  if (message.partial) return message.fetch();
  if (message.embeds.length === 0 && message.attachments.size === 0) {
    return message.fetch().catch(() => message);
  }
  return message;
}

client.once("ready", async () => {
  const channelId = config.channels.leaderboard;

  console.log(`Bot: ${client.user.tag}`);
  console.log(`CHANNEL_LEADERBOARD: ${channelId || "(not set)"}`);

  if (!channelId) {
    console.error("Set CHANNEL_LEADERBOARD in .env first.");
    process.exit(1);
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      console.error(`Channel ${channelId} is not a text channel.`);
      process.exit(1);
    }

    console.log(`Channel: #${channel.name} (${channel.id})`);

    const messages = await channel.messages.fetch({ limit: 15 });
    console.log(`\nLast ${messages.size} message(s):\n`);

    for (const message of messages.values()) {
      const full = await ensureFullMessage(message);
      const debug = describeMessageForDebug(full);
      const likely = isLikelyKaosLeaderboardPost(full);
      const images = extractLeaderboardImages(full);

      console.log(`--- ${debug.id} ---`);
      console.log(`  author: ${debug.author} (bot: ${debug.bot})`);
      console.log(`  embeds: ${debug.embedCount} | attachments: ${debug.attachmentCount}`);
      console.log(`  titles: ${debug.embedTitles.join(", ") || "(none)"}`);
      console.log(`  images found: ${images.length}`);
      console.log(`  likely leaderboard: ${likely}`);
      if (images[0]) console.log(`  primary: ${images[0].url}`);
      console.log("");
    }
  } catch (error) {
    console.error("Failed:", error.message);
    console.error("\nUsually means: wrong channel ID, or bot cannot View Channel / Read History.");
  }

  process.exit(0);
});

client.login(config.discord.token).catch((error) => {
  console.error("Login failed:", error.message);
  process.exit(1);
});

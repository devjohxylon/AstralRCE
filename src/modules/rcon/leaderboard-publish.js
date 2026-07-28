import { AttachmentBuilder } from "discord.js";
import { config } from "../../config.js";
import { getSettings, saveSettings } from "../../data/store.js";
import { renderLeaderboardCard } from "./leaderboard-card.js";

let discordClient = null;

export function attachLeaderboardClient(client) {
  discordClient = client;
}

export async function buildLeaderboardAttachment() {
  const png = await renderLeaderboardCard();
  return new AttachmentBuilder(png, { name: "astral-leaderboard.png" });
}

/**
 * Post or edit the live leaderboard image in CHANNEL_LEADERBOARD.
 * Remembers the message id in settings.json so we edit instead of spam.
 */
export async function publishLeaderboardToDiscord(client = discordClient) {
  const channelId = config.channels.leaderboard;
  if (!channelId || !client) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn("Leaderboard channel missing or not text-based:", channelId);
    return null;
  }

  const file = await buildLeaderboardAttachment();
  const settings = await getSettings();
  const messageId = settings.leaderboardMessageId || null;

  if (messageId) {
    const existing = await channel.messages.fetch(messageId).catch(() => null);
    if (existing) {
      await existing.edit({
        content: "",
        embeds: [],
        files: [file],
      });
      return existing;
    }
  }

  const sent = await channel.send({
    files: [file],
  });
  settings.leaderboardMessageId = sent.id;
  await saveSettings(settings);
  return sent;
}

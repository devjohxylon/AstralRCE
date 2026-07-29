import { AttachmentBuilder } from "discord.js";
import { config } from "../../config.js";
import { getSettings, saveSettings } from "../../data/store.js";
import { renderLeaderboardCard } from "./leaderboard-card.js";

const LEADERBOARD_FILE = "astral-leaderboard.png";

let discordClient = null;
/** Serialize publishes so Ready + interval + panel push never race-post duplicates. */
let publishChain = Promise.resolve();

export function attachLeaderboardClient(client) {
  discordClient = client;
}

export async function buildLeaderboardAttachment() {
  const png = await renderLeaderboardCard();
  return new AttachmentBuilder(png, { name: LEADERBOARD_FILE });
}

function isLeaderboardMessage(msg, client) {
  if (!msg || msg.author?.id !== client.user?.id) return false;
  return msg.attachments?.some(
    (a) => a.name === LEADERBOARD_FILE || /\.png$/i.test(a.name || ""),
  );
}

/** Prefer saved id; otherwise reclaim the newest bot leaderboard post in-channel. */
async function resolveLeaderboardMessage(channel, client, messageId) {
  if (messageId) {
    const existing = await channel.messages.fetch(messageId).catch(() => null);
    if (existing) return existing;
  }

  const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  if (!recent?.size) return null;

  return (
    [...recent.values()].find((m) => isLeaderboardMessage(m, client)) || null
  );
}

async function persistMessageId(messageId) {
  const settings = await getSettings();
  if (settings.leaderboardMessageId === messageId) return;
  settings.leaderboardMessageId = messageId;
  await saveSettings(settings);
}

/**
 * Post or edit the live leaderboard image in CHANNEL_LEADERBOARD.
 * Always edits the same message once one exists (or is found in-channel).
 */
export function publishLeaderboardToDiscord(client = discordClient) {
  const run = publishChain.then(() => publishLeaderboardOnce(client));
  publishChain = run.catch(() => {});
  return run;
}

async function publishLeaderboardOnce(client = discordClient) {
  const channelId = config.channels.leaderboard;
  if (!channelId || !client) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn("Leaderboard channel missing or not text-based:", channelId);
    return null;
  }

  const file = await buildLeaderboardAttachment();
  const settings = await getSettings();
  const existing = await resolveLeaderboardMessage(
    channel,
    client,
    settings.leaderboardMessageId || null,
  );

  if (existing) {
    await existing.edit({
      content: "",
      embeds: [],
      attachments: [],
      files: [file],
    });
    await persistMessageId(existing.id);
    return existing;
  }

  const sent = await channel.send({ files: [file] });
  await persistMessageId(sent.id);
  return sent;
}

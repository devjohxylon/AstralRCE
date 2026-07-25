import { config, channelTypeForId } from "../config.js";
import { serializeMessage } from "../utils/format.js";
import {
  parseLeaderboardMessage,
  leaderboardFingerprint,
  extractLeaderboardImages,
  isLikelyKaosLeaderboardPost,
  describeMessageForDebug,
} from "../utils/leaderboardParser.js";

const relayedMessages = new Set();
const leaderboardState = new Map();
const MAX_TRACKED = 5000;

function trackMessage(messageId) {
  relayedMessages.add(messageId);
  if (relayedMessages.size > MAX_TRACKED) {
    const oldest = relayedMessages.values().next().value;
    relayedMessages.delete(oldest);
  }
}

export function wasRelayed(messageId) {
  return relayedMessages.has(messageId);
}

export function markRelayed(messageId) {
  trackMessage(messageId);
}

function leaderboardChanged(messageId, fingerprint) {
  const previous = leaderboardState.get(messageId);
  if (previous === fingerprint) return false;
  leaderboardState.set(messageId, fingerprint);
  return true;
}

export async function sendToWebsite(payload, url = config.website.ingestUrl) {
  if (config.website.skipSync) return { skipped: true, reason: "website_sync_disabled" };

  const targetUrl = url || config.website.ingestUrl;
  if (!targetUrl) return { skipped: true, reason: "no_ingest_url" };

  let response;
  try {
    response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.website.apiSecret ?? ""}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED" || error.message === "fetch failed") {
      throw new Error(
        `Cannot reach ${targetUrl}. For local testing run "npm run test:ingest". For production set WEBSITE_INGEST_URL to your live site.`,
      );
    }
    throw error;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Website ingest failed (${response.status}): ${body || response.statusText}`);
  }

  return response.json().catch(() => ({}));
}

async function ensureFullMessage(message) {
  if (message.partial) return message.fetch();
  if (message.embeds.length === 0 && message.attachments.size === 0) {
    return message.fetch().catch(() => message);
  }
  return message;
}

export async function getLeaderboardChannel(client) {
  const channelId = config.channels.leaderboard;
  if (!channelId) {
    throw new Error("CHANNEL_LEADERBOARD is not set in .env");
  }

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    throw new Error(
      `Cannot access channel ${channelId}. Check the ID and that Astral Bot can View Channel + Read Message History.`,
    );
  }

  if (!channel?.isTextBased()) {
    throw new Error(`Channel ${channelId} is not a text channel.`);
  }

  return channel;
}

async function relayLeaderboardMessage(message, { force = false } = {}) {
  const full = await ensureFullMessage(message);
  const fingerprint = leaderboardFingerprint(full);

  if (!force && !leaderboardChanged(full.id, fingerprint)) {
    return { skipped: true, reason: "unchanged", messageId: full.id };
  }

  if (force) {
    leaderboardState.set(full.id, fingerprint);
  }

  const leaderboards = parseLeaderboardMessage(full);
  const images = extractLeaderboardImages(full);
  const totalEntries = leaderboards.reduce((sum, board) => sum + board.entries.length, 0);
  const hasText = totalEntries >= config.leaderboard.minEntries;
  const hasImages = images.length > 0;

  if (!hasText && !hasImages) {
    const debug = describeMessageForDebug(full);
    throw new Error(
      `Message ${full.id} from ${debug.author} has no images or stats (embeds: ${debug.embedCount}, attachments: ${debug.attachmentCount}).`,
    );
  }

  const format = hasText && hasImages ? "text_and_image" : hasText ? "text" : "image";

  const payload = {
    type: "leaderboard",
    source: "discord",
    format,
    parsed: hasText,
    primaryImageUrl: images[0]?.url ?? null,
    images,
    leaderboards: hasText ? leaderboards : [],
    ...serializeMessage(full),
  };

  const url = config.website.leaderboardUrl || config.website.ingestUrl;
  await sendToWebsite(payload, url);
  markRelayed(full.id);

  if (format === "image") {
    console.log(`Leaderboard image synced from message ${full.id} (${images.length} image(s))`);
  } else {
    console.log(
      `Leaderboard synced (${leaderboards.length} board(s), ${totalEntries} entries, format=${format}) from message ${full.id}`,
    );
  }

  return payload;
}

async function findLatestLeaderboardMessage(channel, limit = 50) {
  const messages = await channel.messages.fetch({ limit: Math.min(limit, 100) });

  for (const message of messages.values()) {
    const full = await ensureFullMessage(message);
    if (isLikelyKaosLeaderboardPost(full)) return full;
  }

  return null;
}

export async function relayDiscordMessage(message) {
  if (!message.guild) return null;
  if (message.author?.id === message.client.user.id) return null;
  if (!config.channels.watch.has(message.channelId)) return null;

  const type = channelTypeForId(message.channelId);
  if (type === "unknown") return null;

  if (type === "leaderboard") {
    const result = await relayLeaderboardMessage(message);
    return result?.skipped ? null : result;
  }

  if (wasRelayed(message.id)) return null;

  if (message.author?.bot && type !== "kaos_activity") {
    return null;
  }

  const payload = {
    type,
    source: "discord",
    ...serializeMessage(message),
  };

  await sendToWebsite(payload);
  markRelayed(message.id);
  return payload;
}

// Parses a KAOS player-count voice channel name, e.g. "👥・▹🌐23🕑0"
// 🌐 = players online, 🕑 = players in queue.
export function parseServerPop(name) {
  if (!name) return null;
  const players = name.match(/🌐\s*(\d+)/);
  const queue = name.match(/🕑\s*(\d+)/);
  if (!players && !queue) return null;
  return {
    players: players ? Number(players[1]) : 0,
    queued: queue ? Number(queue[1]) : 0,
  };
}

let lastPopName = null;

export async function syncServerPop(client, { silent = false, force = false } = {}) {
  const channelId = config.channels.pop;
  if (!channelId) return null;

  let channel;
  try {
    // force: true bypasses the cache so we always read the live channel name
    // (KAOS renames the channel; cached reads would stay stale).
    channel = await client.channels.fetch(channelId, { force: true });
  } catch {
    if (!silent) {
      console.error(
        `Cannot access POP_CHANNEL_ID ${channelId}. Check the ID and that Astral Bot can View Channel.`,
      );
    }
    return null;
  }

  if (!channel?.name) return null;
  if (!force && channel.name === lastPopName) return null;

  const parsed = parseServerPop(channel.name);
  if (!parsed) {
    if (!silent) {
      console.warn(`Could not parse player count from channel name "${channel.name}".`);
    }
    return null;
  }

  lastPopName = channel.name;

  const payload = {
    type: "server_status",
    players: parsed.players,
    maxPlayers: config.server.max,
    queued: parsed.queued,
    online: true,
  };

  await sendToWebsite(payload);
  console.log(
    `Server pop synced: ${parsed.players}${config.server.max ? "/" + config.server.max : ""} players, ${parsed.queued} queued`,
  );
  return payload;
}

export async function backfillChannel(channel, limit = 25) {
  const isLeaderboard = channel.id === config.channels.leaderboard;

  if (isLeaderboard) {
    const message = await findLatestLeaderboardMessage(channel);
    if (!message) return [];

    const result = await relayLeaderboardMessage(message, { force: true });
    return result?.messageId ? [result.messageId] : [];
  }

  const messages = await channel.messages.fetch({ limit });
  const relayed = [];

  for (const message of [...messages.values()].reverse()) {
    try {
      const result = await relayDiscordMessage(message);
      if (result) relayed.push(result.messageId);
    } catch (error) {
      console.error(`Backfill failed for message ${message.id}:`, error.message);
    }
  }

  return relayed;
}

export async function syncLatestLeaderboard(client, { force = true } = {}) {
  const channel = await getLeaderboardChannel(client);
  const message = await findLatestLeaderboardMessage(channel);

  if (!message) {
    const count = (await channel.messages.fetch({ limit: 1 })).size;
    if (count === 0) {
      throw new Error(`Channel #${channel.name} is empty. Wait for KAOS to post a leaderboard.`);
    }

    throw new Error(
      `No KAOS leaderboard found in the last 50 messages in #${channel.name}. Confirm this is the right channel.`,
    );
  }

  const result = await relayLeaderboardMessage(message, { force });

  if (result?.skipped) {
    throw new Error(
      "Leaderboard unchanged since last sync. KAOS must post a new image first, or the test ingest server may be offline.",
    );
  }

  if (!result?.messageId) {
    throw new Error("Sync failed — check the bot terminal for errors.");
  }

  return [result.messageId];
}

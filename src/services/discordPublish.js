import {
  buildOutboundEmbed,
  eventEmbed,
  wipeEmbed,
} from "../utils/format.js";
import { config } from "../config.js";
import { markRelayed } from "../services/website.js";

function resolveChannel(client, type) {
  const channelId = config.channels.outbound[type];
  if (!channelId) {
    throw new Error(`Channel not configured for type "${type}"`);
  }

  const channel = client.channels.cache.get(channelId);
  if (!channel?.isTextBased()) {
    throw new Error(`Channel ${channelId} is missing or not text-based`);
  }

  return channel;
}

function buildPayload(body) {
  const { type, title, content, embed, pin, color, fields, url } = body;

  if (embed) {
    return {
      content: content || undefined,
      embeds: [embed],
      pin: Boolean(pin),
    };
  }

  if (type === "wipe") {
    return {
      embeds: [
        wipeEmbed({
          title,
          content,
          wipeAt: body.wipeAt,
          map: body.map,
          fields,
        }),
      ],
      pin: Boolean(pin),
    };
  }

  if (type === "event") {
    return {
      embeds: [
        eventEmbed({
          title,
          content,
          startsAt: body.startsAt,
          location: body.location,
          fields,
        }),
      ],
      pin: Boolean(pin),
    };
  }

  return {
    content: content || undefined,
    embeds: [
      buildOutboundEmbed({
        title: title || "Announcement",
        content,
        color,
        fields,
        url,
        footer: "Astral RCE",
      }),
    ],
    pin: Boolean(pin),
  };
}

export async function publishFromWebsite(client, body) {
  const type = body.type;
  if (!["announcement", "wipe", "event"].includes(type)) {
    throw new Error(`Unsupported publish type "${type}"`);
  }

  const channel = resolveChannel(client, type);
  const payload = buildPayload(body);
  const message = await channel.send(payload);

  if (payload.pin) {
    await message.pin().catch((error) => {
      console.warn(`Could not pin message ${message.id}:`, error.message);
    });
  }

  markRelayed(message.id);
  return {
    messageId: message.id,
    channelId: channel.id,
    jumpUrl: message.url,
  };
}

export async function getBotStatus(client) {
  const watched = [...config.channels.watch];
  const outbound = Object.entries(config.channels.outbound)
    .filter(([, id]) => Boolean(id))
    .map(([type, id]) => ({ type, id }));

  return {
    ready: client.isReady(),
    user: client.user?.tag ?? null,
    guildId: config.discord.guildId || null,
    watchedChannels: watched,
    outboundChannels: outbound,
    websiteIngestUrl: config.website.ingestUrl,
    websiteLeaderboardUrl: config.website.leaderboardUrl || config.website.ingestUrl,
    leaderboardChannelId: config.channels.leaderboard,
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

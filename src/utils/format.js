const MAX_FIELD_LENGTH = 1024;

export function truncate(text, max = MAX_FIELD_LENGTH) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export function serializeEmbed(embed) {
  if (!embed) return null;

  return {
    title: embed.title ?? null,
    description: embed.description ?? null,
    url: embed.url ?? null,
    color: embed.color ?? null,
    timestamp: embed.timestamp ?? null,
    footer: embed.footer
      ? { text: embed.footer.text, iconUrl: embed.footer.iconURL ?? null }
      : null,
    author: embed.author
      ? {
          name: embed.author.name,
          url: embed.author.url ?? null,
          iconUrl: embed.author.iconURL ?? null,
        }
      : null,
    fields: (embed.fields ?? []).map((field) => ({
      name: field.name,
      value: truncate(field.value),
      inline: field.inline ?? false,
    })),
    image: embed.image ? { url: embed.image.url } : null,
    thumbnail: embed.thumbnail ? { url: embed.thumbnail.url } : null,
  };
}

export function serializeMessage(message) {
  return {
    messageId: message.id,
    channelId: message.channelId,
    guildId: message.guildId,
    authorId: message.author?.id ?? null,
    authorName: message.author?.displayName ?? message.author?.username ?? "Unknown",
    authorBot: message.author?.bot ?? false,
    content: message.content ?? "",
    embeds: message.embeds.map(serializeEmbed).filter(Boolean),
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType,
    })),
    timestamp: message.createdAt.toISOString(),
    jumpUrl: message.url,
  };
}

export function buildOutboundEmbed({ title, content, color, fields = [], url, footer }) {
  const embed = {
    title: title || undefined,
    description: content ? truncate(content, 4096) : undefined,
    color: color ?? 0xe67e22,
    timestamp: new Date().toISOString(),
  };

  if (url) embed.url = url;
  if (footer) embed.footer = { text: footer };
  if (fields.length > 0) {
    embed.fields = fields.map((field) => ({
      name: field.name,
      value: truncate(field.value),
      inline: field.inline ?? false,
    }));
  }

  return embed;
}

export function wipeEmbed({ title, content, wipeAt, map, fields = [] }) {
  const embedFields = [...fields];

  if (wipeAt) {
    embedFields.unshift({
      name: "Wipe time",
      value: `<t:${Math.floor(new Date(wipeAt).getTime() / 1000)}:F>`,
      inline: true,
    });
  }

  if (map) {
    embedFields.unshift({ name: "Map", value: map, inline: true });
  }

  return buildOutboundEmbed({
    title: title || "Wipe schedule",
    content,
    color: 0x3498db,
    fields: embedFields,
    footer: "Astral RCE",
  });
}

export function eventEmbed({ title, content, startsAt, location, fields = [] }) {
  const embedFields = [...fields];

  if (startsAt) {
    embedFields.unshift({
      name: "Starts",
      value: `<t:${Math.floor(new Date(startsAt).getTime() / 1000)}:F>`,
      inline: true,
    });
  }

  if (location) {
    embedFields.unshift({ name: "Location", value: location, inline: true });
  }

  return buildOutboundEmbed({
    title: title || "Server event",
    content,
    color: 0x9b59b6,
    fields: embedFields,
    footer: "Astral RCE",
  });
}

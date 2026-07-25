const CATEGORY_KEYWORDS = [
  { category: "kills", patterns: [/kill/i, /topkiller/i, /murder/i] },
  { category: "deaths", patterns: [/death/i] },
  { category: "kd", patterns: [/k\/d/i, /\bkd\b/i, /ratio/i] },
  { category: "playtime", patterns: [/playtime/i, /time played/i, /hours/i] },
  { category: "balance", patterns: [/balance/i, /points/i, /currency/i] },
  { category: "raids", patterns: [/raid/i] },
];

const ENTRY_LINE =
  /^(?:#?(?<rank>\d+)[.)]\s*|(?<medal>[\u{1F947}\u{1F948}\u{1F949}])\s*)?(?<name>.+?)\s*(?:[-–|:]\s*|\s{2,})(?<value>.+)$/u;

const FIELD_RANK = /^#?(?<rank>\d+)\.?\s*(?<name>.+)$/i;
const VALUE_NUMBER = /(-?\d[\d,]*(?:\.\d+)?)/;

function inferCategory(title = "") {
  const normalized = title.trim();
  if (!normalized) return "general";

  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) {
      return entry.category;
    }
  }

  return "general";
}

function medalToRank(medal) {
  if (medal === "\u{1F947}") return 1;
  if (medal === "\u{1F948}") return 2;
  if (medal === "\u{1F949}") return 3;
  return null;
}

function parseValue(rawValue) {
  const text = String(rawValue ?? "").trim();
  const match = text.match(VALUE_NUMBER);
  return {
    raw: text,
    numeric: match ? Number(match[1].replace(/,/g, "")) : null,
  };
}

function cleanName(name) {
  return String(name ?? "")
    .replace(/\*\*/g, "")
    .replace(/^[@#]+/, "")
    .replace(/[<>`]/g, "")
    .trim();
}

function parseLine(line, fallbackRank) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("```")) return null;
  if (/^[-=_*]{3,}$/.test(trimmed)) return null;

  const match = trimmed.match(ENTRY_LINE);
  if (!match?.groups) return null;

  const rank = Number(match.groups.rank) || medalToRank(match.groups.medal) || fallbackRank;
  const name = cleanName(match.groups.name);
  const value = parseValue(match.groups.value);

  if (!name) return null;

  return {
    rank,
    name,
    value: value.numeric,
    valueRaw: value.raw,
    stat: inferStatLabel(value.raw),
  };
}

function inferStatLabel(valueRaw) {
  const lower = valueRaw.toLowerCase();
  if (lower.includes("kill")) return "kills";
  if (lower.includes("death")) return "deaths";
  if (lower.includes("hour") || lower.includes("min")) return "playtime";
  if (lower.includes("point") || lower.includes("balance")) return "balance";
  if (lower.includes("k/d") || lower.includes("kd")) return "kd";
  return "score";
}

function parseLines(text, title) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const entries = [];
  let fallbackRank = 1;

  for (const line of lines) {
    const entry = parseLine(line, fallbackRank);
    if (!entry) continue;
    entries.push({ ...entry, rank: entry.rank || fallbackRank });
    fallbackRank = (entry.rank || fallbackRank) + 1;
  }

  if (entries.length === 0) return null;

  return {
    category: inferCategory(title),
    title: title || "Leaderboard",
    entries,
  };
}

function parseEmbedFields(embed) {
  const title = embed.title ?? embed.author?.name ?? "Leaderboard";
  const entries = [];

  for (const field of embed.fields ?? []) {
    const rankMatch = field.name.match(FIELD_RANK);
    if (rankMatch) {
      const value = parseValue(field.value);
      entries.push({
        rank: Number(rankMatch.groups.rank),
        name: cleanName(rankMatch.groups.name),
        value: value.numeric,
        valueRaw: value.raw,
        stat: inferStatLabel(field.value),
      });
      continue;
    }

    const fromValue = parseLine(`${field.name} - ${field.value}`, entries.length + 1);
    if (fromValue) entries.push(fromValue);
  }

  if (entries.length > 0) {
    return {
      category: inferCategory(title),
      title,
      entries: entries.sort((a, b) => a.rank - b.rank),
    };
  }

  const chunks = [embed.description, embed.footer?.text].filter(Boolean).join("\n");
  return parseLines(chunks, title);
}

function parseEmbed(embed) {
  const fromFields = parseEmbedFields(embed);
  if (fromFields) return fromFields;

  const title = embed.title ?? "Leaderboard";
  return parseLines(embed.description ?? "", title);
}

export function parseLeaderboardMessage(message) {
  const leaderboards = [];

  for (const embed of message.embeds) {
    const parsed = parseEmbed(embed);
    if (parsed?.entries?.length) leaderboards.push(parsed);
  }

  if (message.content?.trim()) {
    const parsed = parseLines(message.content, "Leaderboard");
    if (parsed?.entries?.length) leaderboards.push(parsed);
  }

  return leaderboards;
}

function isImageAttachment(attachment) {
  if (attachment.contentType?.startsWith("image/")) return true;
  if (attachment.contentType === "application/octet-stream") return true;
  const name = attachment.name ?? attachment.description ?? "";
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);
}

const DISCORD_CDN_URL =
  /https?:\/\/(?:cdn|media)\.discordapp\.(?:com|net)\/[^\s>)]+/gi;

function embedMediaUrl(embed, key) {
  return embed?.[key]?.url ?? embed?.data?.[key]?.url ?? null;
}

export function extractLeaderboardImages(message) {
  const images = [];
  const seen = new Set();

  function addImage(url, name, source) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push({ url, name: name ?? null, source });
  }

  for (const attachment of message.attachments.values()) {
    if (isImageAttachment(attachment) || message.author?.bot) {
      addImage(attachment.url ?? attachment.proxyURL, attachment.name, "attachment");
    }
  }

  for (const embed of message.embeds) {
    addImage(
      embedMediaUrl(embed, "image"),
      embed.title ?? embed.author?.name ?? "Leaderboard",
      "embed_image",
    );
    addImage(embedMediaUrl(embed, "thumbnail"), embed.title ?? "Thumbnail", "embed_thumbnail");

    for (const url of embed.description?.match(DISCORD_CDN_URL) ?? []) {
      addImage(url, embed.title ?? "Embed link", "embed_description");
    }
  }

  for (const url of message.content?.match(DISCORD_CDN_URL) ?? []) {
    addImage(url, "Message link", "content");
  }

  return images;
}

export function isLeaderboardMessage(message) {
  const leaderboards = parseLeaderboardMessage(message);
  const hasEntries = leaderboards.some((board) => board.entries.length > 0);
  const hasImages = extractLeaderboardImages(message).length > 0;
  return hasEntries || hasImages;
}

export function isLikelyKaosLeaderboardPost(message) {
  if (isLeaderboardMessage(message)) return true;

  if (!message.author?.bot) return false;

  return message.embeds.length > 0 || message.attachments.size > 0;
}

export function describeMessageForDebug(message) {
  return {
    id: message.id,
    author: message.author?.username ?? "unknown",
    bot: message.author?.bot ?? false,
    contentLength: message.content?.length ?? 0,
    embedCount: message.embeds.length,
    attachmentCount: message.attachments.size,
    images: extractLeaderboardImages(message).map((image) => image.url),
    embedTitles: message.embeds.map((embed) => embed.title).filter(Boolean),
  };
}

export function leaderboardFingerprint(message) {
  return JSON.stringify({
    content: message.content ?? "",
    embeds: message.embeds.map((embed) => embed.toJSON()),
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
    })),
  });
}

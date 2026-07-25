import { config } from "../../config.js";
import { isAutomodExempt } from "../../lib/permissions.js";
import { sendModLog } from "../../lib/modlog.js";
import { getBlockedWords } from "../../data/store.js";

const recentMessages = new Map();
const joinTimestamps = [];

const SCAM_PATTERNS = [
  /discord\s*(?:gift|nitro|app\.com\/gift)/i,
  /free\s+nitro/i,
  /steam\s*community\s*gift/i,
  /@everyone.*(?:http|www|discord\.gg)/i,
  /(?:login|verify).{0,20}(?:steam|discord).{0,20}(?:http|www)/i,
];

const INVITE_PATTERN = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/gi;

function trackMessage(userId, content) {
  const now = Date.now();
  const list = recentMessages.get(userId) ?? [];
  list.push({ content, at: now });
  const trimmed = list.filter((entry) => now - entry.at < 8000).slice(-8);
  recentMessages.set(userId, trimmed);
  return trimmed;
}

function isDuplicateSpam(entries) {
  if (entries.length < 4) return false;
  const last = entries.at(-1)?.content?.toLowerCase().trim();
  const dupes = entries.filter((e) => e.content.toLowerCase().trim() === last);
  return dupes.length >= 3;
}

function isFastSpam(entries) {
  return entries.length >= 6;
}

function hasBlockedLinks(content) {
  const urls = content.match(URL_PATTERN) ?? [];
  if (urls.length === 0) return null;

  for (const raw of urls) {
    const url = raw.toLowerCase();
    const allowed = config.automod.linkAllowlist.some((domain) => url.includes(domain));
    if (!allowed) return raw;
  }
  return null;
}

function hasBlockedInvite(content) {
  if (!INVITE_PATTERN.test(content)) return false;
  if (config.automod.allowInvites) return false;
  const allowed = config.automod.linkAllowlist.some((d) => content.toLowerCase().includes(d));
  return !allowed;
}

async function hasBlockedWord(content) {
  const lower = content.toLowerCase();
  const words = [...config.automod.wordBlocklist, ...(await getBlockedWords())];
  for (const word of words) {
    if (!word) continue;
    if (lower.includes(word.toLowerCase())) return word;
  }
  return null;
}

function hasScamPattern(content) {
  return SCAM_PATTERNS.find((pattern) => pattern.test(content)) ?? null;
}

function isCapsSpam(content) {
  if (content.length < 20) return false;
  const letters = content.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 12) return false;
  const caps = letters.replace(/[^A-Z]/g, "").length;
  return caps / letters.length > 0.75;
}

function accountTooNew(user) {
  if (!user) return false;
  const ageMs = Date.now() - user.createdTimestamp;
  return ageMs < config.automod.minAccountDays * 86_400_000;
}

function memberTooNew(member) {
  if (!member?.joinedTimestamp) return false;
  const joinMs = Date.now() - member.joinedTimestamp;
  return joinMs < config.automod.minJoinHours * 3_600_000;
}

export function trackMemberJoin() {
  const now = Date.now();
  joinTimestamps.push(now);
  while (joinTimestamps.length && now - joinTimestamps[0] > config.automod.raidWindowSeconds * 1000) {
    joinTimestamps.shift();
  }
  return joinTimestamps.length;
}

export async function runAutomod(message) {
  if (!config.automod.enabled) return null;
  if (!message.guild || message.author?.bot) return null;
  if (isAutomodExempt(message.member)) return null;

  const content = message.content ?? "";
  if (!content.trim()) return null;

  const entries = trackMessage(message.author.id, content);

  let reason = null;

  if (accountTooNew(message.author) && memberTooNew(message.member) && URL_PATTERN.test(content)) {
    reason = "New account posted links";
  }

  if (!reason && hasScamPattern(content)) reason = "Scam / phishing pattern detected";
  if (!reason && hasBlockedInvite(content)) reason = "Unauthorized Discord invite";
  if (!reason && hasBlockedLinks(content)) reason = "Link not on allowlist";
  if (!reason && (await hasBlockedWord(content))) reason = "Blocked word / slur filter";
  if (!reason && isDuplicateSpam(entries)) reason = "Duplicate message spam";
  if (!reason && isFastSpam(entries)) reason = "Message spam (too fast)";
  if (!reason && isCapsSpam(content)) reason = "Excessive caps";

  if (!reason) return null;

  await message.delete().catch(() => {});
  await sendModLog(message.guild, {
    title: "Auto-mod action",
    userId: message.author.id,
    reason,
    extra: { name: "Channel", value: `<#${message.channelId}>`, inline: true },
  });

  if (message.channel?.isTextBased()) {
    await message.channel
      .send(`⚠️ <@${message.author.id}> your message was removed: **${reason}**`)
      .then((warn) => setTimeout(() => warn.delete().catch(() => {}), 8000))
      .catch(() => {});
  }

  return reason;
}

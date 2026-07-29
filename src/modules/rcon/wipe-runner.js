import { EmbedBuilder } from "discord.js";
import { config } from "../../config.js";
import { getSettings, saveSettings, getHomes, saveHomes } from "../../data/store.js";
import { sendGameCommand, isRconEnabled } from "./client.js";
import { resetStats, statsSummary } from "./stats.js";
import { clearTeleportCooldowns } from "./teleports.js";
import { clearKillStreaks } from "./feeds.js";
import { clearGroupAlertState } from "./reports.js";
import { setWipeAt, syncWipeStatus } from "./wipe.js";
import { publishLeaderboardToDiscord } from "./leaderboard-publish.js";

/** Steps available in the wipe checklist / runner. */
export const WIPE_STEPS = [
  {
    id: "resetStats",
    label: "Stats & leaderboard",
    hint: "Kills, deaths, playtime",
    defaultOn: true,
  },
  {
    id: "clearHomes",
    label: "Homes",
    hint: "Clear /home set points",
    defaultOn: true,
  },
  {
    id: "clearTpCooldowns",
    label: "TP cooldowns",
    hint: "Home / warp / TPR",
    defaultOn: true,
  },
  {
    id: "clearKitCooldowns",
    label: "Kit cooldowns",
    hint: "RCON KitManager reset",
    defaultOn: true,
  },
  {
    id: "clearStreaks",
    label: "Kill streaks",
    hint: "Killfeed streak counters",
    defaultOn: true,
  },
  {
    id: "clearGroupAlerts",
    label: "Group alerts",
    hint: "Trio alert cooldowns",
    defaultOn: true,
  },
  {
    id: "publishLeaderboard",
    label: "Republish boards",
    hint: "Discord + website image",
    defaultOn: true,
  },
  {
    id: "clearWipeCountdown",
    label: "Clear countdown",
    hint: "Wipe status channel → TBA",
    defaultOn: true,
  },
  {
    id: "announce",
    label: "Announce",
    hint: "Discord + in-game say",
    defaultOn: true,
  },
];

const KIT_RESET_COMMANDS = [
  "kit resetcooldowns",
  "kit reset all",
  "kit clearcooldowns",
  "kits.reset",
];

function defaultEnabled() {
  return Object.fromEntries(WIPE_STEPS.map((s) => [s.id, s.defaultOn]));
}

export async function getWipeAutomationConfig() {
  const settings = await getSettings();
  const stored = settings.wipeAutomation || {};
  const enabled = { ...defaultEnabled(), ...(stored.enabled || {}) };
  return {
    steps: WIPE_STEPS.map((s) => ({
      ...s,
      enabled: enabled[s.id] !== false,
    })),
    autoRunOnSchedule: Boolean(stored.autoRunOnSchedule),
    lastRun: stored.lastRun || null,
    lastResults: Array.isArray(stored.lastResults) ? stored.lastResults : [],
    checklist: stored.checklist || {},
  };
}

export async function saveWipeAutomationConfig(patch = {}) {
  const settings = await getSettings();
  const current = settings.wipeAutomation || {};
  const next = {
    ...current,
    enabled: { ...defaultEnabled(), ...(current.enabled || {}), ...(patch.enabled || {}) },
    autoRunOnSchedule:
      patch.autoRunOnSchedule != null
        ? Boolean(patch.autoRunOnSchedule)
        : Boolean(current.autoRunOnSchedule),
    checklist: patch.checklist
      ? { ...(current.checklist || {}), ...patch.checklist }
      : current.checklist || {},
  };
  settings.wipeAutomation = next;
  await saveSettings(settings);
  return getWipeAutomationConfig();
}

async function stepResetStats(wipeLabel) {
  const data = await resetStats(wipeLabel);
  return { wipe: data.wipe, trackedPlayers: 0 };
}

async function stepClearHomes() {
  const data = await getHomes();
  const count = Object.keys(data.players || {}).length;
  data.players = {};
  await saveHomes(data);
  return { cleared: count };
}

async function stepClearKitCooldowns() {
  if (!isRconEnabled()) {
    return { ok: false, skipped: true, reason: "RCON offline" };
  }
  const attempts = [];
  for (const cmd of KIT_RESET_COMMANDS) {
    try {
      const result = await sendGameCommand(cmd);
      const text = String(result || "").toLowerCase();
      const looksBad =
        /unknown|invalid|not found|doesn't exist|does not exist|error/i.test(text) &&
        text.length < 200;
      attempts.push({ cmd, ok: !looksBad, result: String(result || "").slice(0, 200) });
      if (!looksBad) {
        return { ok: true, command: cmd, result: String(result || "").slice(0, 200), attempts };
      }
    } catch (error) {
      attempts.push({ cmd, ok: false, error: error.message });
    }
  }
  return {
    ok: false,
    warning:
      "No kit reset command succeeded — reset cooldowns in KitManager / Nitrado if needed",
    attempts,
  };
}

async function stepPublishLeaderboard(client) {
  const { pushLeaderboardToWebsite } = await import("./index.js");
  const website = await pushLeaderboardToWebsite().catch((e) => ({ error: e.message }));
  const discord = await publishLeaderboardToDiscord(client).catch((e) => ({
    error: e.message,
  }));
  return { website, discord: discord?.id ? { messageId: discord.id } : discord };
}

async function stepAnnounce(client, wipeLabel) {
  const out = { discord: false, ingame: false };
  const channelId = config.channels.wipes || config.channels.announcements;
  if (client && channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      const embed = new EmbedBuilder()
        .setColor(0xc9a227)
        .setTitle("Server wiped")
        .setDescription(
          `Wipe **${wipeLabel}** is live.\nStats and leaderboards have been reset — good luck.`,
        )
        .setTimestamp(new Date());
      await channel.send({ embeds: [embed] }).catch(() => {});
      out.discord = true;
    }
  }
  if (isRconEnabled()) {
    await sendGameCommand(
      `say <color=#c9a227>Server wiped</color> — stats reset. Have a good wipe!`,
    ).catch(() => {});
    out.ingame = true;
  }
  return out;
}

/**
 * Run selected wipe automation steps.
 * @param {object} opts
 * @param {string[]} [opts.steps] step ids (default: all currently enabled)
 * @param {string} [opts.wipeLabel]
 * @param {import('discord.js').Client} [opts.client]
 * @param {boolean} [opts.fromSchedule]
 */
export async function runWipeAutomation({
  steps = null,
  wipeLabel = null,
  client = null,
  fromSchedule = false,
} = {}) {
  const cfg = await getWipeAutomationConfig();
  const label = (wipeLabel || new Date().toISOString().slice(0, 10)).trim();
  const selected =
    Array.isArray(steps) && steps.length
      ? steps
      : cfg.steps.filter((s) => s.enabled).map((s) => s.id);

  const results = [];
  const runStep = async (id, fn) => {
    if (!selected.includes(id)) return;
    try {
      const detail = await fn();
      results.push({ id, ok: detail?.ok !== false, detail });
    } catch (error) {
      results.push({ id, ok: false, error: error.message });
    }
  };

  await runStep("resetStats", () => stepResetStats(label));
  await runStep("clearHomes", () => stepClearHomes());
  await runStep("clearTpCooldowns", () => {
    clearTeleportCooldowns();
    return { ok: true };
  });
  await runStep("clearKitCooldowns", () => stepClearKitCooldowns());
  await runStep("clearStreaks", () => {
    clearKillStreaks();
    return { ok: true };
  });
  await runStep("clearGroupAlerts", async () => {
    await clearGroupAlertState();
    return { ok: true };
  });
  await runStep("publishLeaderboard", () => stepPublishLeaderboard(client));
  await runStep("clearWipeCountdown", async () => {
    await setWipeAt(null);
    await syncWipeStatus(client, { force: true }).catch(() => {});
    return { ok: true };
  });
  await runStep("announce", () => stepAnnounce(client, label));

  const summary = await statsSummary().catch(() => null);
  const settings = await getSettings();
  settings.wipeAutomation = {
    ...(settings.wipeAutomation || {}),
    enabled: Object.fromEntries(cfg.steps.map((s) => [s.id, s.enabled])),
    autoRunOnSchedule: cfg.autoRunOnSchedule,
    lastRun: {
      at: new Date().toISOString(),
      wipeLabel: label,
      fromSchedule,
      ok: results.every((r) => r.ok),
    },
    lastResults: results,
    checklist: Object.fromEntries(selected.map((id) => [id, true])),
  };
  await saveSettings(settings);

  return {
    ok: results.every((r) => r.ok),
    wipeLabel: label,
    results,
    summary,
  };
}

/** Called by wipe scheduler when countdown hits zero (once per wipeAt). */
export async function maybeAutoRunWipe(client) {
  const settings = await getSettings();
  const wipeAt = settings.wipeAt || config.wipe.at || null;
  if (!wipeAt) return null;

  const target = new Date(wipeAt).getTime();
  if (Number.isNaN(target) || Date.now() < target) return null;

  const auto = settings.wipeAutomation || {};
  if (!auto.autoRunOnSchedule) return null;
  if (auto.lastAutoForWipeAt === wipeAt) return null;

  const result = await runWipeAutomation({
    client,
    fromSchedule: true,
    wipeLabel: new Date().toISOString().slice(0, 10),
  });

  const next = await getSettings();
  next.wipeAutomation = {
    ...(next.wipeAutomation || {}),
    lastAutoForWipeAt: wipeAt,
  };
  await saveSettings(next);
  return result;
}

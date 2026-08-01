import { config } from "../../config.js";
import { DATA_DIR, getLinks, getSettings } from "../../data/store.js";
import { getBotStatus } from "../../services/discordPublish.js";
import { getRconStatus } from "../rcon/client.js";
import { listReports } from "../rcon/reports.js";
import { getVipClaimStatus } from "../rcon/vip-claims.js";

async function readPersistence() {
  const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
  const volumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || null;
  const dataOnVolume =
    volumeMount &&
    (DATA_DIR === volumeMount ||
      DATA_DIR.startsWith(volumeMount.replace(/\/$/, "") + "/"));
  const links = await getLinks().catch(() => ({ byDiscord: {} }));
  return {
    dataDir: DATA_DIR,
    persistent: !onRailway || Boolean(dataOnVolume),
    onRailway,
    volumeMount,
    linkCount: Object.keys(links.byDiscord || {}).length,
  };
}

/**
 * Green/red ops health for Railway + Discord + RCON.
 * @param {import("discord.js").Client} client
 */
export async function buildHealthReport(client) {
  const rcon = getRconStatus();
  const bot = await getBotStatus(client).catch(() => ({}));
  const persistence = await readPersistence();
  const settings = await getSettings().catch(() => ({}));
  const vipLock = await getVipClaimStatus(config.vip?.postWipeLockHours ?? 4).catch(() => null);
  const reports = listReports({ limit: 5 });
  const lastKill = reports.combat?.[0] || null;

  const checks = [];

  if (!rcon.enabled) {
    checks.push({ id: "rcon", label: "RCON", status: "warn", detail: "Not configured" });
  } else if (rcon.connected) {
    checks.push({ id: "rcon", label: "RCON", status: "ok", detail: "Connected" });
  } else {
    checks.push({
      id: "rcon",
      label: "RCON",
      status: "bad",
      detail: rcon.lastError ? String(rcon.lastError).slice(0, 64) : "Offline",
    });
  }

  checks.push(
    client?.isReady?.()
      ? { id: "discord", label: "Discord", status: "ok", detail: bot.user || "Ready" }
      : { id: "discord", label: "Discord", status: "bad", detail: "Bot down" },
  );

  if (persistence.onRailway && !persistence.persistent) {
    checks.push({
      id: "volume",
      label: "Volume",
      status: "bad",
      detail: "No volume on DATA_DIR — data resets on deploy",
    });
  } else {
    checks.push({
      id: "volume",
      label: "Volume",
      status: "ok",
      detail: persistence.onRailway
        ? `Mounted · ${persistence.linkCount} links`
        : `Local · ${persistence.linkCount} links`,
    });
  }

  const killAgeMs = lastKill?.at ? Date.now() - new Date(lastKill.at).getTime() : null;
  if (!lastKill) {
    checks.push({ id: "combat", label: "Last kill", status: "warn", detail: "No combat logged yet" });
  } else if (killAgeMs != null && killAgeMs > 6 * 60 * 60 * 1000) {
    checks.push({
      id: "combat",
      label: "Last kill",
      status: "warn",
      detail: `${lastKill.killer} → ${lastKill.victim} · stale`,
    });
  } else {
    checks.push({
      id: "combat",
      label: "Last kill",
      status: "ok",
      detail: `${lastKill.killer} → ${lastKill.victim}`,
    });
  }

  const lbAt = settings.leaderboardLastPublishedAt || null;
  if (!config.channels?.leaderboard) {
    checks.push({ id: "leaderboard", label: "Leaderboard", status: "warn", detail: "Channel unset" });
  } else if (!lbAt) {
    checks.push({ id: "leaderboard", label: "Leaderboard", status: "warn", detail: "Never published" });
  } else {
    const age = Date.now() - new Date(lbAt).getTime();
    checks.push({
      id: "leaderboard",
      label: "Leaderboard",
      status: age > 30 * 60 * 1000 ? "warn" : "ok",
      detail: `Pushed ${new Date(lbAt).toLocaleString()}`,
    });
  }

  const membersIntentOk = Boolean(
    client?.options?.intents?.has?.("GuildMembers") ||
      client?.options?.intents?.has?.(1 << 1) ||
      intents.ready,
  );
  checks.push(
    client?.isReady?.()
      ? {
          id: "intents",
          label: "Intents",
          status: "ok",
          detail: membersIntentOk ? "Bot ready (members/messages)" : "Ready — verify Members intent in portal",
        }
      : { id: "intents", label: "Intents", status: "bad", detail: "Cannot verify — bot offline" },
  );

  if (settings.raidMode) {
    checks.push({ id: "raid", label: "Raid mode", status: "warn", detail: "ON — channels locked" });
  }

  if (vipLock?.locked) {
    checks.push({
      id: "vipLock",
      label: "VIP lock",
      status: "warn",
      detail: `Post-wipe lock · ${vipLock.hoursRemaining ?? "?"}h left`,
    });
  }

  const ok = checks.filter((c) => c.status === "ok").length;
  const bad = checks.filter((c) => c.status === "bad").length;
  const warn = checks.filter((c) => c.status === "warn").length;

  return {
    ok: true,
    summary: { ok, warn, bad, overall: bad ? "bad" : warn ? "warn" : "ok" },
    checks,
    persistence: {
      dataDir: persistence.dataDir,
      persistent: Boolean(persistence.persistent),
      onRailway: Boolean(persistence.onRailway),
      volumeMount: persistence.volumeMount || null,
      linkCount: persistence.linkCount ?? 0,
    },
    rcon,
    bot: {
      user: bot.user || null,
      ready: Boolean(client?.isReady?.()),
      uptimeSeconds: bot.uptimeSeconds ?? null,
    },
    lastKill,
    leaderboardLastPublishedAt: lbAt,
    raidMode: Boolean(settings.raidMode),
    vipLock,
  };
}

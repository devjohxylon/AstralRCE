import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getBotStatus } from "../../services/discordPublish.js";
import {
  getOnlinePlayers,
  getRconStatus,
  getServerInfo,
  sendGameCommand,
  getMapMetadata,
  clearMapMetadataCache,
} from "../../modules/rcon/client.js";
import { getPlayersWithPositions } from "../../modules/rcon/live-map.js";
import {
  ensureMapPreview,
  hasCachedMapImage,
  readCachedMapImage,
  saveUploadedMapImage,
  clearMapImage,
  getMapImageMeta,
} from "../../modules/rcon/map-preview.js";
import {
  forceLink,
  listLinks,
  unlinkDiscord,
} from "../../modules/rcon/linking.js";
import {
  deleteWarp,
  listWarps,
  teleportPlayer,
  getPlayerPosition,
} from "../../modules/rcon/teleports.js";
import { getLeaderboard, getPlayerCard, statsSummary, resetStats } from "../../modules/rcon/stats.js";
import {
  addAutoMessage,
  listAutoMessages,
  removeAutoMessage,
  toggleAutoMessage,
  updateAutoMessage,
} from "../../modules/rcon/automessages.js";
import {
  addScheduledCommand,
  listScheduledCommands,
  removeScheduledCommand,
  runScheduledCommandNow,
  toggleScheduledCommand,
  updateScheduledCommand,
} from "../../modules/rcon/scheduler.js";
import { pushLeaderboardToWebsite } from "../../modules/rcon/index.js";
import { listRustItems } from "../../data/rust-items.js";
import {
  addServerKitItem,
  deleteKit,
  deleteServerKit,
  getServerKitDetails,
  giveKit,
  listKits,
  listServerKits,
  removeServerKitItem,
  resyncServerKits,
  upsertKit,
} from "../../modules/rcon/kits.js";
import { getWipeAt, setWipeAt, syncWipeStatus } from "../../modules/rcon/wipe.js";
import {
  EVENT_PRESETS,
  RANK_PRESETS,
  getChannelConfig,
  saveChannelConfig,
} from "../../modules/admin/channel-settings.js";
import {
  getFeedSettingsForPanel,
  saveFeedSettings,
} from "../../modules/admin/feed-settings.js";
import {
  getCommandSettingsForPanel,
  saveCommandSettings,
} from "../../modules/admin/command-settings.js";
import {
  getStatusSettingsForPanel,
  saveStatusSettings,
} from "../../modules/admin/status-settings.js";
import { listReports, scanAllTeams, searchCombat } from "../../modules/rcon/reports.js";
import {
  STAFF_PERMISSIONS,
  appendPanelLog,
  authenticateAccessKey,
  clearSessionCookie,
  createAccessKey,
  hasPerm,
  listAccessKeys,
  listPanelLogs,
  resolveSession,
  revokeAccessKey,
  setSessionCookie,
  updateAccessKey,
} from "../../modules/admin/access-keys.js";
import { getAnalyticsSummary } from "../../modules/analytics/tracker.js";
import {
  getPlayerProfile,
  addPlayerNote,
  removePlayerNote,
  addPlayerTag,
  removePlayerTag,
  addPlayerWarning,
  searchPlayers,
  listAllProfiles,
} from "../../modules/profiles/manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_HTML = readFileSync(path.join(__dirname, "panel.html"), "utf8");

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function clientIp(req) {
  const forwarded = String(req.get("x-forwarded-for") || "")
    .split(",")[0]
    .trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function checkLoginRate(ip) {
  const now = Date.now();
  let row = loginAttempts.get(ip);
  if (!row || now > row.windowUntil) {
    row = { count: 0, windowUntil: now + LOGIN_WINDOW_MS, lockedUntil: 0 };
    loginAttempts.set(ip, row);
  }
  if (row.lockedUntil && now < row.lockedUntil) {
    return { ok: false, retryAfterSec: Math.ceil((row.lockedUntil - now) / 1000) };
  }
  return { ok: true, row };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const check = checkLoginRate(ip);
  const row = check.row || loginAttempts.get(ip);
  if (!row) return;
  row.count += 1;
  if (row.count >= LOGIN_MAX_ATTEMPTS) {
    row.lockedUntil = now + LOGIN_LOCK_MS;
    row.count = 0;
    row.windowUntil = now + LOGIN_WINDOW_MS;
  }
}

function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

async function requireAuth(req, res, next) {
  try {
    const session = await resolveSession(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    req.session = session;
    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message || "Auth failed" });
  }
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!hasPerm(req.session, perm)) {
      return res.status(403).json({ error: "Missing permission" });
    }
    return next();
  };
}

async function audit(req, action, detail = {}) {
  try {
    await appendPanelLog({
      action,
      detail,
      by: req.session?.label || "unknown",
      role: req.session?.role || "unknown",
      keyId: req.session?.keyId || null,
    });
  } catch {
    /* ignore audit failures */
  }
}

export async function attachAdminPanel(app, client) {
  app.get("/", (_req, res) => res.redirect(302, "/admin"));

  app.get("/admin", (_req, res) => {
    res.type("html").send(PANEL_HTML);
  });

  app.get("/admin/", (_req, res) => res.redirect("/admin"));

  app.post("/admin/api/login", async (req, res) => {
    const ip = clientIp(req);
    const rate = checkLoginRate(ip);
    if (!rate.ok) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      return res.status(429).json({
        ok: false,
        error: `Too many login attempts. Try again in ${rate.retryAfterSec}s.`,
      });
    }

    const password = String(req.body?.password ?? "");
    const session = await authenticateAccessKey(password);
    if (!session) {
      recordLoginFailure(ip);
      await appendPanelLog({
        action: "login_failed",
        by: "unknown",
        role: "anonymous",
        detail: { ip },
      }).catch(() => {});
      return res.status(401).json({ ok: false, error: "Wrong access key" });
    }

    clearLoginFailures(ip);
    setSessionCookie(res, {
      role: session.role,
      label: session.label,
      keyId: session.keyId,
      permissions: session.permissions,
    });
    await appendPanelLog({
      action: "login",
      by: session.label,
      role: session.role,
      keyId: session.keyId,
    }).catch(() => {});
    return res.json({
      ok: true,
      role: session.role,
      label: session.label,
      permissions: session.permissions,
    });
  });

  app.post("/admin/api/logout", async (req, res) => {
    const session = await resolveSession(req);
    if (session) {
      await appendPanelLog({
        action: "logout",
        by: session.label,
        role: session.role,
        keyId: session.keyId,
      }).catch(() => {});
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/admin/api/session", async (req, res) => {
    const session = await resolveSession(req);
    if (!session) return res.json({ ok: true, authed: false });
    return res.json({
      ok: true,
      authed: true,
      role: session.role,
      label: session.label,
      permissions: session.permissions,
      staffPermissionDefaults: STAFF_PERMISSIONS,
    });
  });

  app.get("/admin/api/overview", requireAuth, requirePerm("overview"), async (_req, res) => {
    const info = getServerInfo();
    const rcon = getRconStatus();
    const bot = await getBotStatus(client);
    const stats = await statsSummary();
    const players = getOnlinePlayers();
    const wipeAt = await getWipeAt();

    const mapMetadata = await getMapMetadata();

    res.json({
      ok: true,
      rcon,
      server: info
        ? {
            hostname: info.Hostname,
            players: info.Players,
            maxPlayers: info.MaxPlayers,
            queued: info.Queued,
            joining: info.Joining,
            map: info.Map,
            mapSeed: mapMetadata.seed,
            mapSize: mapMetadata.size,
            mapImageUrl: mapMetadata.imageUrl || null,
            gameTime: info.GameTime,
            uptime: info.Uptime,
            fps: info.Framerate,
            entities: info.EntityCount,
            restarting: info.Restarting,
          }
        : null,
      onlinePlayers: players.map((p) => ({
        ign: p.ign,
        ping: p.ping ?? null,
        team: p.team?.id ?? null,
        platform: p.platform ?? null,
      })),
      bot: {
        user: bot.user,
        uptimeSeconds: bot.uptimeSeconds,
        ready: client.isReady(),
      },
      stats,
      wipe: {
        wipeAt,
        localInput: wipeAt
          ? new Date(wipeAt).toISOString().slice(0, 16)
          : "",
      },
    });
  });

  app.get("/admin/api/players", requireAuth, requirePerm("players"), async (_req, res) => {
    const links = await listLinks();
    const linkByIgn = Object.fromEntries(links.map((l) => [l.ign.toLowerCase(), l]));
    const online = getOnlinePlayers().map((p) => ({
      ign: p.ign,
      ping: p.ping ?? null,
      platform: p.platform ?? null,
      link: linkByIgn[p.ign.toLowerCase()] ?? null,
    }));
    res.json({ ok: true, online, links });
  });

  app.post("/admin/api/rcon", requireAuth, requirePerm("rcon"), async (req, res) => {
    try {
      const command = String(req.body?.command ?? "").trim();
      if (!command) return res.status(400).json({ ok: false, error: "Missing command" });
      const result = await sendGameCommand(command);
      await audit(req, "rcon", { command });
      res.json({ ok: true, result: result ?? "" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/admin/api/map", requireAuth, requirePerm("overview"), async (_req, res) => {
    const mapMetadata = await getMapMetadata();
    const seed = mapMetadata.seed;
    const size = mapMetadata.size;
    const imageReady = await hasCachedMapImage(seed, size);
    const meta = imageReady ? await getMapImageMeta() : null;
    let preview = null;
    if (imageReady) {
      preview = {
        ok: true,
        status: meta?.source === "upload" ? "uploaded" : "cached",
        imageReady: true,
        source: meta?.source || "cache",
      };
    } else {
      // Only try URL / optional RustMaps — never invent a wrong PC map by default
      preview = await ensureMapPreview(seed, size).catch((e) => ({
        ok: false,
        status: "error",
        imageReady: false,
        message: e.message,
      }));
    }
    res.json({
      ok: true,
      seed,
      size,
      imageUrl: preview?.imageReady
        ? `/admin/api/map/image?seed=${seed || 0}&size=${size || 0}`
        : null,
      imageReady: Boolean(preview?.imageReady),
      imageStatus: preview?.status || (seed ? "needs_upload" : "no_seed"),
      imageMessage: preview?.message || null,
      imageSource: preview?.source || meta?.source || null,
      players: getPlayersWithPositions(),
    });
  });

  app.get("/admin/api/map/image", requireAuth, requirePerm("overview"), async (req, res) => {
    try {
      const seed = Number(req.query.seed) || null;
      const size = Number(req.query.size) || 4000;
      const buf = await readCachedMapImage(seed, size);
      if (!buf) {
        return res.status(404).json({ ok: false, error: "No map image uploaded yet" });
      }
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      res.setHeader("Content-Type", isPng ? "image/png" : "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(buf);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/map/image", requireAuth, requirePerm("overview"), async (req, res) => {
    try {
      const mapMetadata = await getMapMetadata();
      const dataUrl = String(req.body?.image || req.body?.dataUrl || "");
      const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
      if (!match) {
        return res.status(400).json({
          ok: false,
          error: "Send { image: 'data:image/png;base64,...' } from an in-game map screenshot",
        });
      }
      const buf = Buffer.from(match[2], "base64");
      const preview = await saveUploadedMapImage(buf, {
        seed: mapMetadata.seed,
        size: mapMetadata.size,
        filename: req.body?.filename || null,
      });
      await audit(req, "map_image_upload", {
        seed: mapMetadata.seed,
        size: mapMetadata.size,
        bytes: buf.length,
      });
      res.json({
        ok: true,
        ...preview,
        seed: mapMetadata.seed,
        size: mapMetadata.size,
        imageUrl: `/admin/api/map/image?seed=${mapMetadata.seed || 0}&size=${mapMetadata.size || 0}`,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/admin/api/map/image", requireAuth, requirePerm("overview"), async (req, res) => {
    try {
      const mapMetadata = await getMapMetadata();
      await clearMapImage(mapMetadata.seed, mapMetadata.size);
      await audit(req, "map_image_clear", { seed: mapMetadata.seed, size: mapMetadata.size });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/map/refresh", requireAuth, requirePerm("overview"), async (req, res) => {
    try {
      clearMapMetadataCache();
      const mapMetadata = await getMapMetadata();
      // Refresh seed/size only — do not overwrite an uploaded console map with PC RustMaps
      const preview = (await hasCachedMapImage(mapMetadata.seed, mapMetadata.size))
        ? {
            imageReady: true,
            status: "cached",
            source: (await getMapImageMeta())?.source || "cache",
          }
        : await ensureMapPreview(mapMetadata.seed, mapMetadata.size, { force: false });
      await audit(req, "map_refresh", {
        seed: mapMetadata.seed,
        size: mapMetadata.size,
        imageStatus: preview.status,
      });
      res.json({
        ok: true,
        ...mapMetadata,
        imageReady: Boolean(preview.imageReady),
        imageStatus: preview.status,
        imageMessage: preview.message || null,
        imageSource: preview.source || null,
        imageUrl: preview.imageReady
          ? `/admin/api/map/image?seed=${mapMetadata.seed || 0}&size=${mapMetadata.size || 0}`
          : null,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/broadcast", requireAuth, requirePerm("broadcast"), async (req, res) => {
    try {
      const message = String(req.body?.message ?? "").trim();
      if (!message) return res.status(400).json({ ok: false, error: "Missing message" });
      const result = await sendGameCommand(`say <color=#00ffcc>[Astral]</color> ${message}`);
      await audit(req, "broadcast", { message });
      res.json({ ok: true, result: result ?? "" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/players/:ign/kick", requireAuth, requirePerm("kick"), async (req, res) => {
    try {
      const reason = String(req.body?.reason ?? "Kicked by admin");
      const result = await sendGameCommand(`kick "${req.params.ign}" "${reason}"`);
      await audit(req, "kick", { ign: req.params.ign, reason });
      res.json({ ok: true, result: result ?? "" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/players/:ign/ban", requireAuth, requirePerm("ban"), async (req, res) => {
    try {
      const reason = String(req.body?.reason ?? "Banned by admin");
      const { banPlayer } = await import("../../modules/bans/manager.js");
      const stored = await banPlayer(req.params.ign, reason, req.session.label);
      // Already banned in our store is fine — still ensure game ban
      const result = await sendGameCommand(`ban "${req.params.ign}" "${reason}"`).catch((e) => {
        if (!stored.ok && stored.error !== "Player is already banned") throw e;
        return e.message;
      });
      await audit(req, "ban", { ign: req.params.ign, reason });
      res.json({
        ok: true,
        result: result ?? "",
        ban: stored.ban || null,
        stored: stored.ok || stored.error === "Player is already banned",
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/players/:ign/teleport", requireAuth, requirePerm("teleport"), async (req, res) => {
    try {
      const { x, y, z, toPlayer } = req.body ?? {};
      if (toPlayer) {
        const pos = await getPlayerPosition(toPlayer);
        await teleportPlayer(req.params.ign, pos);
        await audit(req, "teleport", { ign: req.params.ign, toPlayer });
        return res.json({ ok: true, pos });
      }
      if (x == null || y == null || z == null) {
        return res.status(400).json({ ok: false, error: "Need x,y,z or toPlayer" });
      }
      await teleportPlayer(req.params.ign, { x: Number(x), y: Number(y), z: Number(z) });
      await audit(req, "teleport", { ign: req.params.ign, x, y, z });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/admin/api/stats", requireAuth, requirePerm("stats"), async (req, res) => {
    const category = String(req.query.category ?? "kills");
    const rows = await getLeaderboard(category, 25);
    const summary = await statsSummary();
    res.json({ ok: true, category, rows, summary });
  });

  app.get("/admin/api/stats/:name", requireAuth, requirePerm("stats"), async (req, res) => {
    const card = await getPlayerCard(req.params.name);
    if (!card) return res.status(404).json({ ok: false, error: "Player not found" });
    res.json({ ok: true, player: card });
  });

  app.post("/admin/api/stats/reset", requireAuth, requirePerm("statsReset"), async (req, res) => {
    const label = req.body?.label;
    const data = await resetStats(label);
    await audit(req, "stats_reset", { label: data.wipe });
    res.json({ ok: true, wipe: data.wipe });
  });

  app.post("/admin/api/stats/push", requireAuth, requirePerm("stats"), async (req, res) => {
    try {
      const result = await pushLeaderboardToWebsite();
      const { publishLeaderboardToDiscord } = await import("../../modules/rcon/leaderboard-publish.js");
      const discordMsg = await publishLeaderboardToDiscord(client).catch((e) => ({ error: e.message }));
      await audit(req, "stats_push");
      res.json({
        ok: true,
        result,
        discord: discordMsg?.error
          ? { ok: false, error: discordMsg.error }
          : { ok: true, messageId: discordMsg?.id || null },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/admin/api/links", requireAuth, requirePerm("links"), async (_req, res) => {
    res.json({ ok: true, links: await listLinks() });
  });

  app.post("/admin/api/links", requireAuth, requirePerm("links"), async (req, res) => {
    const { discordId, ign } = req.body ?? {};
    if (!discordId || !ign) return res.status(400).json({ ok: false, error: "Need discordId + ign" });
    const result = await forceLink(String(discordId), String(ign));
    await audit(req, "link_force", { discordId, ign });
    res.json({ ok: true, ...result });
  });

  app.delete("/admin/api/links/:discordId", requireAuth, requirePerm("links"), async (req, res) => {
    const result = await unlinkDiscord(req.params.discordId);
    if (!result.ok) return res.status(404).json(result);
    await audit(req, "unlink", { discordId: req.params.discordId });
    res.json(result);
  });

  app.get("/admin/api/warps", requireAuth, requirePerm("warps"), async (_req, res) => {
    const data = await import("../../data/store.js").then((m) => m.getHomes());
    res.json({ ok: true, warps: data.warps ?? {}, names: await listWarps() });
  });

  app.post("/admin/api/warps", requireAuth, requirePerm("warps"), async (req, res) => {
    try {
      const { name, x, y, z, fromPlayer } = req.body ?? {};
      if (!name) return res.status(400).json({ ok: false, error: "Missing name" });

      let pos;
      if (fromPlayer) {
        pos = await getPlayerPosition(fromPlayer);
      } else if (x != null && y != null && z != null) {
        pos = { x: Number(x), y: Number(y), z: Number(z) };
      } else {
        return res.status(400).json({ ok: false, error: "Need coords or fromPlayer" });
      }

      const data = await import("../../data/store.js").then((m) => m.getHomes());
      const { saveHomes } = await import("../../data/store.js");
      data.warps[String(name).toLowerCase()] = {
        ...pos,
        setAt: new Date().toISOString(),
        setBy: "admin-panel",
      };
      await saveHomes(data);
      await audit(req, "warp_set", { name, pos });
      res.json({ ok: true, name: String(name).toLowerCase(), pos });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/admin/api/warps/:name", requireAuth, requirePerm("warps"), async (req, res) => {
    const result = await deleteWarp(req.params.name);
    if (!result.ok) return res.status(404).json(result);
    await audit(req, "warp_delete", { name: req.params.name });
    res.json(result);
  });

  app.get("/admin/api/automessages", requireAuth, requirePerm("automessages"), async (_req, res) => {
    res.json({ ok: true, messages: await listAutoMessages() });
  });

  app.post("/admin/api/automessages", requireAuth, requirePerm("automessages"), async (req, res) => {
    const { text, intervalMinutes } = req.body ?? {};
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });
    const message = await addAutoMessage(text, intervalMinutes);
    await audit(req, "automsg_add");
    res.json({ ok: true, message });
  });

  app.patch("/admin/api/automessages/:id", requireAuth, requirePerm("automessages"), async (req, res) => {
    const result = await updateAutoMessage(req.params.id, req.body ?? {});
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/admin/api/automessages/:id/toggle", requireAuth, requirePerm("automessages"), async (req, res) => {
    const result = await toggleAutoMessage(req.params.id, Boolean(req.body?.enabled));
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.delete("/admin/api/automessages/:id", requireAuth, requirePerm("automessages"), async (req, res) => {
    const result = await removeAutoMessage(req.params.id);
    if (!result.ok) return res.status(404).json(result);
    await audit(req, "automsg_delete", { id: req.params.id });
    res.json(result);
  });

  app.get("/admin/api/schedule", requireAuth, requirePerm("schedule"), async (_req, res) => {
    res.json({ ok: true, jobs: await listScheduledCommands() });
  });

  app.post("/admin/api/schedule", requireAuth, requirePerm("schedule"), async (req, res) => {
    const { name, command, intervalMinutes } = req.body ?? {};
    if (!command) return res.status(400).json({ ok: false, error: "Missing command" });
    const job = await addScheduledCommand({ name, command, intervalMinutes });
    await audit(req, "schedule_add", { command });
    res.json({ ok: true, job });
  });

  app.patch("/admin/api/schedule/:id", requireAuth, requirePerm("schedule"), async (req, res) => {
    const result = await updateScheduledCommand(req.params.id, req.body ?? {});
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/admin/api/schedule/:id/toggle", requireAuth, requirePerm("schedule"), async (req, res) => {
    const result = await toggleScheduledCommand(req.params.id, Boolean(req.body?.enabled));
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/admin/api/schedule/:id/run", requireAuth, requirePerm("schedule"), async (req, res) => {
    try {
      const result = await runScheduledCommandNow(req.params.id);
      if (!result.ok) return res.status(400).json(result);
      await audit(req, "schedule_run", { id: req.params.id });
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/admin/api/schedule/:id", requireAuth, requirePerm("schedule"), async (req, res) => {
    const result = await removeScheduledCommand(req.params.id);
    if (!result.ok) return res.status(404).json(result);
    await audit(req, "schedule_delete", { id: req.params.id });
    res.json(result);
  });

  // ——— Kits ———
  app.get("/admin/api/items", requireAuth, requirePerm("kits"), (req, res) => {
    const q = String(req.query.q ?? "");
    const category = String(req.query.category ?? "");
    res.json({ ok: true, ...listRustItems({ q, category }) });
  });

  app.get("/admin/api/kits", requireAuth, requirePerm("kits"), async (req, res) => {
    const refresh = String(req.query.refresh ?? "1") !== "0";
    const force = String(req.query.force ?? "0") === "1";
    const panel = await listKits();
    const server = await listServerKits({ refresh: refresh || force, force }).catch((error) => ({
      ok: false,
      error: error.message,
      kits: [],
      host: null,
      port: null,
      endpointKey: null,
      rawPreview: null,
    }));
    res.json({
      ok: true,
      kits: panel,
      serverKits: server.kits || [],
      serverOk: server.ok !== false,
      serverError: server.error || null,
      serverHost: server.host || null,
      serverPort: server.port || null,
      serverEndpoint: server.endpointKey || null,
      serverRaw: server.rawPreview || null,
    });
  });

  app.post("/admin/api/kits/resync", requireAuth, requirePerm("kits"), async (req, res) => {
    try {
      const detail = Boolean(req.body?.detail);
      const server = await resyncServerKits({ detail });
      await audit(req, "kits_resync", {
        count: server.kits?.length || 0,
        host: server.host,
        port: server.port,
        detail,
      });
      res.json({
        ok: server.ok !== false,
        kits: server.kits || [],
        count: server.kits?.length || 0,
        host: server.host || null,
        port: server.port || null,
        endpointKey: server.endpointKey || null,
        error: server.error || null,
        rawPreview: server.rawPreview || null,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message, kits: [], count: 0 });
    }
  });

  app.get("/admin/api/kits/server/:name", requireAuth, requirePerm("kits"), async (req, res) => {
    try {
      const result = await getServerKitDetails(req.params.name);
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message, items: [] });
    }
  });

  app.post("/admin/api/kits/server/item", requireAuth, requirePerm("kits"), async (req, res) => {
    try {
      const { kit, item, amount, condition, container } = req.body ?? {};
      const result = await addServerKitItem(kit, { item, amount, condition, container });
      if (!result.ok) return res.status(400).json(result);
      await audit(req, "kit_server_item_add", { kit, item, amount });
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/kits/server/item/remove", requireAuth, requirePerm("kits"), async (req, res) => {
    try {
      const { kit, itemId } = req.body ?? {};
      const result = await removeServerKitItem(kit, itemId);
      if (!result.ok) return res.status(400).json(result);
      await audit(req, "kit_server_item_remove", { kit, itemId });
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/kits/server/delete", requireAuth, requirePerm("kits"), async (req, res) => {
    try {
      const kit = String(req.body?.id ?? req.body?.name ?? "").trim();
      if (!kit) return res.status(400).json({ ok: false, error: "Missing kit name" });
      const result = await deleteServerKit(kit);
      await audit(req, "kit_server_delete", { kit, ok: result.ok !== false });
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message, kits: [] });
    }
  });

  app.post("/admin/api/kits", requireAuth, requirePerm("kits"), async (req, res) => {
    const { id, label, items, cooldownMinutes } = req.body ?? {};
    const result = await upsertKit({ id, label, items, cooldownMinutes });
    if (!result.ok) return res.status(400).json(result);
    await audit(req, "kit_upsert", { id: result.kit.id });
    res.json(result);
  });

  app.delete("/admin/api/kits/:id", requireAuth, requirePerm("kits"), async (req, res) => {
    const result = await deleteKit(req.params.id);
    if (!result.ok) return res.status(404).json(result);
    await audit(req, "kit_delete", { id: req.params.id });
    res.json(result);
  });

  app.post("/admin/api/kits/:id/give", requireAuth, requirePerm("kits"), async (req, res) => {
    try {
      const ign = String(req.body?.ign ?? "").trim();
      const source = String(req.body?.source ?? "auto").trim();
      if (!ign) return res.status(400).json({ ok: false, error: "Missing player IGN" });
      const result = await giveKit(ign, req.params.id, { source });
      await audit(req, "kit_give", {
        id: req.params.id,
        ign,
        given: result.given,
        source: result.source || source,
      });
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // ——— Wipe countdown ———
  app.get("/admin/api/wipe", requireAuth, requirePerm("overview"), async (_req, res) => {
    const wipeAt = await getWipeAt();
    res.json({ ok: true, wipeAt });
  });

  app.post("/admin/api/wipe", requireAuth, requirePerm("overview"), async (req, res) => {
    const raw = req.body?.wipeAt;
    const result = await setWipeAt(raw === "" || raw == null ? null : String(raw));
    if (!result.ok) return res.status(400).json(result);
    await syncWipeStatus(client, { force: true }).catch(() => {});
    await audit(req, "wipe_set", { wipeAt: result.wipeAt });
    res.json(result);
  });

  // ——— Discord channels + Server Commands (kits / ranks / events) ———
  async function loadDiscordChannelPicker() {
    const { config } = await import("../../config.js");
    const guild = config.discord.guildId
      ? await client.guilds.fetch(config.discord.guildId).catch(() => null)
      : client.guilds.cache.first() || null;

    let discordChannels = [];
    if (guild) {
      const chans = await guild.channels.fetch().catch(() => null);
      if (chans) {
        discordChannels = [...chans.values()]
          .filter((c) => c && typeof c.isTextBased === "function" && (c.isTextBased() || c.isVoiceBased?.()))
          .map((c) => ({
            id: c.id,
            name: c.name,
            type: c.isVoiceBased?.() ? "voice" : "text",
            parent: c.parent?.name || null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    return {
      channels: await getChannelConfig(),
      discordChannels,
      ...(await getFeedSettingsForPanel()),
      ...(await getCommandSettingsForPanel()),
      ...(await getStatusSettingsForPanel()),
    };
  }

  app.get("/admin/api/channels", requireAuth, requirePerm("serverCommands"), async (_req, res) => {
    try {
      res.json({ ok: true, ...(await loadDiscordChannelPicker()) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/feeds", requireAuth, requirePerm("serverCommands"), async (req, res) => {
    const patch = req.body?.feeds ?? req.body ?? {};
    if (!patch || typeof patch !== "object") {
      return res.status(400).json({ ok: false, error: "Missing feeds object" });
    }
    try {
      const result = await saveFeedSettings(patch);
      if (!result.ok) return res.status(400).json(result);
      await audit(req, "feeds_save", { keys: Object.keys(patch) });
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/commands", requireAuth, requirePerm("serverCommands"), async (req, res) => {
    const patch = req.body?.commands ?? req.body ?? {};
    if (!patch || typeof patch !== "object") {
      return res.status(400).json({ ok: false, error: "Missing commands object" });
    }
    try {
      const result = await saveCommandSettings(patch);
      if (!result.ok) return res.status(400).json(result);
      await audit(req, "commands_save", { keys: Object.keys(patch) });
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/status-displays", requireAuth, requirePerm("serverCommands"), async (req, res) => {
    const patch = req.body?.statusDisplays ?? req.body ?? {};
    if (!patch || typeof patch !== "object") {
      return res.status(400).json({ ok: false, error: "Missing statusDisplays object" });
    }
    try {
      const result = await saveStatusSettings(patch);
      if (!result.ok) return res.status(400).json(result);
      await audit(req, "status_displays_save", { keys: Object.keys(patch) });
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/admin/api/server-commands", requireAuth, requirePerm("serverCommands"), async (req, res) => {
    const online = getOnlinePlayers().map((p) => p.ign);
    const panelKits = await listKits();
    const server = await listServerKits({ refresh: false }).catch(() => ({ kits: [] }));
    const allKits = [
      ...panelKits.map((k) => ({ ...k, optLabel: `${k.label} [panel]` })),
      ...(server.kits || []).map((k) => ({ ...k, optLabel: `${k.label} [server]` })),
    ];
    const isOwner = req.session?.role === "owner";
    const ranks = RANK_PRESETS
      .filter((r) => isOwner || r.id !== "owner")
      .map((r) => ({ id: r.id, label: r.label }));
    res.json({
      ok: true,
      kits: allKits,
      events: EVENT_PRESETS,
      ranks,
      canCustomRcon: hasPerm(req.session, "rcon"),
      onlinePlayers: online,
      rcon: getRconStatus(),
    });
  });

  app.post("/admin/api/channels", requireAuth, requirePerm("serverCommands"), async (req, res) => {
    const patch = req.body?.channels ?? req.body ?? {};
    if (!patch || typeof patch !== "object") {
      return res.status(400).json({ ok: false, error: "Missing channels object" });
    }
    const result = await saveChannelConfig(patch);
    if (!result.ok) return res.status(400).json(result);
    await audit(req, "channels_save", { keys: Object.keys(patch) });
    res.json(result);
  });

  app.post("/admin/api/ranks", requireAuth, requirePerm("serverCommands"), async (req, res) => {
    try {
      const ign = String(req.body?.ign ?? "").trim();
      const rank = String(req.body?.rank ?? "").trim().toLowerCase();
      const action = String(req.body?.action ?? "grant").trim().toLowerCase();
      if (!ign) return res.status(400).json({ ok: false, error: "Missing player IGN" });

      if (rank === "owner" && req.session?.role !== "owner") {
        return res.status(403).json({ ok: false, error: "Only the panel owner can grant/revoke in-game Owner" });
      }

      if (rank === "vip") {
        const { config } = await import("../../config.js");
        if (action === "revoke") {
          if (!config.vip.revokeCommand) {
            return res.status(400).json({
              ok: false,
              error: "Set VIP_RCON_REVOKE in .env to revoke VIP via RCON",
            });
          }
          const cmd = config.vip.revokeCommand
            .replaceAll("{ign}", ign)
            .replaceAll("{player}", ign);
          const result = await sendGameCommand(cmd);
          await audit(req, "rank_revoke", { rank: "vip", ign, cmd });
          return res.json({ ok: true, result: result ?? "", command: cmd });
        }

        if (config.vip.grantCommand) {
          const cmd = config.vip.grantCommand
            .replaceAll("{ign}", ign)
            .replaceAll("{player}", ign);
          const result = await sendGameCommand(cmd);
          await audit(req, "rank_grant", { rank: "vip", ign, via: "command" });
          return res.json({ ok: true, result: result ?? "", command: cmd });
        }

        const kitResult = await giveKit(ign, config.vip.kitId || "vip");
        await audit(req, "rank_grant", { rank: "vip", ign, via: "kit" });
        if (!kitResult.ok) return res.status(400).json(kitResult);
        return res.json(kitResult);
      }

      const preset = RANK_PRESETS.find((r) => r.id === rank);
      if (!preset) return res.status(400).json({ ok: false, error: "Unknown rank" });

      const cmd = action === "revoke" ? preset.revoke(ign) : preset.grant(ign);
      const result = await sendGameCommand(cmd);
      await audit(req, action === "revoke" ? "rank_revoke" : "rank_grant", { rank, ign, cmd });
      res.json({ ok: true, result: result ?? "", command: cmd });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // Preset event triggers (serverCommands). Custom raw RCON requires rcon perm.
  app.post("/admin/api/events/trigger", requireAuth, requirePerm("serverCommands"), async (req, res) => {
    try {
      const id = String(req.body?.id ?? "").trim();
      const custom = String(req.body?.command ?? "").trim();

      if (custom) {
        if (!hasPerm(req.session, "rcon")) {
          return res.status(403).json({
            ok: false,
            error: "Custom RCON requires the rcon permission",
          });
        }
        const result = await sendGameCommand(custom);
        await audit(req, "event_trigger", { id: null, command: custom, custom: true });
        return res.json({ ok: true, result: result ?? "", command: custom });
      }

      const preset = EVENT_PRESETS.find((e) => e.id === id);
      if (!preset?.command) {
        return res.status(400).json({ ok: false, error: "Pick a preset event" });
      }

      const result = await sendGameCommand(preset.command);
      await audit(req, "event_trigger", { id: preset.id, command: preset.command });
      res.json({ ok: true, result: result ?? "", command: preset.command });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // ——— Reports (combat + group limit) ———
  app.get("/admin/api/reports", requireAuth, requirePerm("reports"), async (req, res) => {
    const limit = Number(req.query.limit) || 80;
    const q = String(req.query.q ?? "").trim();
    const data = listReports({ limit });
    if (q) {
      data.combat = searchCombat(q, limit);
    }
    res.json({ ok: true, ...data });
  });

  app.post("/admin/api/reports/scan", requireAuth, requirePerm("reports"), async (req, res) => {
    try {
      const hits = await scanAllTeams();
      await audit(req, "group_scan", { hits: hits.length });
      res.json({ ok: true, hits });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // ——— Owner-only: access keys ———
  app.get("/admin/api/keys", requireAuth, requirePerm("keys"), async (_req, res) => {
    res.json({ ok: true, keys: await listAccessKeys(), defaults: STAFF_PERMISSIONS });
  });

  app.post("/admin/api/keys", requireAuth, requirePerm("keys"), async (req, res) => {
    const { label, permissions } = req.body ?? {};
    const created = await createAccessKey({ label, permissions });
    await audit(req, "key_create", { label: created.key.label, id: created.key.id });
    res.status(201).json({ ok: true, ...created });
  });

  app.patch("/admin/api/keys/:id", requireAuth, requirePerm("keys"), async (req, res) => {
    const key = await updateAccessKey(req.params.id, req.body ?? {});
    if (!key) return res.status(404).json({ ok: false, error: "Key not found" });
    await audit(req, "key_update", { id: key.id, enabled: key.enabled });
    res.json({ ok: true, key });
  });

  app.delete("/admin/api/keys/:id", requireAuth, requirePerm("keys"), async (req, res) => {
    const ok = await revokeAccessKey(req.params.id);
    if (!ok) return res.status(404).json({ ok: false, error: "Key not found" });
    await audit(req, "key_revoke", { id: req.params.id });
    res.json({ ok: true });
  });

  // ——— Owner-only: audit logs ———
  app.get("/admin/api/logs", requireAuth, requirePerm("logs"), async (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json({ ok: true, entries: await listPanelLogs(limit) });
  });

  // ——— Analytics Dashboard ———
  app.get("/admin/api/analytics", requireAuth, requirePerm("overview"), async (_req, res) => {
    try {
      const data = await getAnalyticsSummary();
      res.json({ ok: true, ...data });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // ——— Player Profiles ———
  app.get("/admin/api/profiles", requireAuth, requirePerm("players"), async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const profiles = q ? await searchPlayers(q) : await listAllProfiles();
      res.json({ ok: true, profiles });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/admin/api/profiles/:ign", requireAuth, requirePerm("players"), async (req, res) => {
    try {
      const profile = await getPlayerProfile(req.params.ign);
      const { getBanHistory } = await import("../../modules/bans/manager.js");
      const banHistory = await getBanHistory(req.params.ign).catch(() => []);
      res.json({ ok: true, profile, banHistory });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/profiles/:ign/notes", requireAuth, requirePerm("players"), async (req, res) => {
    try {
      const { text } = req.body ?? {};
      if (!text) return res.status(400).json({ ok: false, error: "Missing note text" });
      const note = await addPlayerNote(req.params.ign, text, req.session.label);
      await audit(req, "player_note_add", { ign: req.params.ign });
      res.json({ ok: true, note });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/admin/api/profiles/:ign/notes/:noteId", requireAuth, requirePerm("players"), async (req, res) => {
    try {
      const result = await removePlayerNote(req.params.ign, req.params.noteId);
      if (!result.ok) return res.status(404).json(result);
      await audit(req, "player_note_delete", { ign: req.params.ign, noteId: req.params.noteId });
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/profiles/:ign/tags", requireAuth, requirePerm("players"), async (req, res) => {
    try {
      const { tag } = req.body ?? {};
      if (!tag) return res.status(400).json({ ok: false, error: "Missing tag" });
      const result = await addPlayerTag(req.params.ign, tag);
      await audit(req, "player_tag_add", { ign: req.params.ign, tag });
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/admin/api/profiles/:ign/tags/:tag", requireAuth, requirePerm("players"), async (req, res) => {
    try {
      const result = await removePlayerTag(req.params.ign, req.params.tag);
      if (!result.ok) return res.status(404).json(result);
      await audit(req, "player_tag_delete", { ign: req.params.ign, tag: req.params.tag });
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/profiles/:ign/warnings", requireAuth, requirePerm("players"), async (req, res) => {
    try {
      const { reason } = req.body ?? {};
      if (!reason) return res.status(400).json({ ok: false, error: "Missing reason" });
      const warning = await addPlayerWarning(req.params.ign, reason, req.session.label);
      await audit(req, "player_warning_add", { ign: req.params.ign, reason });
      res.json({ ok: true, warning });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // ——— Audit Log ———
  const { getAuditEntries } = await import("../../modules/audit/logger.js");
  
  app.get("/admin/api/audit", requireAuth, requirePerm("logs"), async (req, res) => {
    try {
      const filters = {
        admin: req.query.admin,
        action: req.query.action,
        target: req.query.target,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        limit: Number(req.query.limit) || 100,
      };
      const entries = await getAuditEntries(filters);
      res.json({ ok: true, entries });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // ——— Ban Management ———
  const {
    banPlayer,
    unbanPlayer,
    getBanHistory,
    getAllActiveBans,
    getAllBans,
    syncBansFromServer,
    backfillBansFromPanelLogs,
  } = await import("../../modules/bans/manager.js");

  async function fetchServerBanlist() {
    const commands = [
      "banlistex",
      "global.banlistex",
      "banlist",
      "global.banlist",
      "bans",
      "global.bans",
      "listid",
      "global.listid",
    ];
    const attempts = [];
    for (const cmd of commands) {
      try {
        const raw = await sendGameCommand(cmd);
        const text = String(raw ?? "").trim();
        attempts.push({ cmd, bytes: text.length, preview: text.slice(0, 240) });
        if (text) return { raw: text, cmd, attempts };
      } catch (error) {
        attempts.push({ cmd, error: error.message });
      }
    }
    return { raw: null, cmd: null, attempts };
  }

  app.get("/admin/api/bans", requireAuth, requirePerm("ban"), async (req, res) => {
    try {
      await backfillBansFromPanelLogs().catch(() => null);

      let sync = null;
      if (req.query.sync !== "0") {
        const fetched = await fetchServerBanlist().catch((e) => ({
          raw: null,
          attempts: [{ error: e.message }],
        }));
        if (fetched.raw) {
          sync = await syncBansFromServer(fetched.raw).catch((e) => ({
            ok: false,
            error: e.message,
          }));
          if (sync && typeof sync === "object") {
            sync.command = fetched.cmd;
            sync.rawPreview = fetched.raw.slice(0, 400);
          }
        } else {
          sync = {
            ok: false,
            error: "Empty banlist response from RCON",
            attempts: fetched.attempts,
          };
        }
      }

      const active = await getAllActiveBans();
      const history = (await getAllBans({ includeInactive: true, limit: 200 })).filter(
        (b) => !b.active,
      );
      res.json({ ok: true, bans: active, history, sync });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/bans/sync", requireAuth, requirePerm("ban"), async (req, res) => {
    try {
      const fromLogs = await backfillBansFromPanelLogs();
      const fetched = await fetchServerBanlist();
      if (!fetched.raw) {
        console.warn("Ban sync: empty RCON banlist", fetched.attempts);
        return res.json({
          ok: true,
          fromLogs,
          sync: {
            ok: false,
            error: "Could not read banlist from server (empty RCON response)",
            attempts: fetched.attempts,
          },
          bans: await getAllActiveBans(),
        });
      }
      console.log(
        `Ban sync via ${fetched.cmd}: ${fetched.raw.length} chars\n${fetched.raw.slice(0, 500)}`,
      );
      const sync = await syncBansFromServer(fetched.raw);
      sync.command = fetched.cmd;
      sync.rawPreview = fetched.raw.slice(0, 400);
      await audit(req, "bans_sync", {
        added: sync.added,
        parsed: sync.parsed,
        command: fetched.cmd,
      });
      res.json({ ok: true, fromLogs, sync, bans: await getAllActiveBans() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/admin/api/bans/:ign/history", requireAuth, requirePerm("players"), async (req, res) => {
    try {
      const history = await getBanHistory(req.params.ign);
      res.json({ ok: true, history });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/bans", requireAuth, requirePerm("ban"), async (req, res) => {
    try {
      const { ign, reason, duration } = req.body ?? {};
      if (!ign) return res.status(400).json({ ok: false, error: "Missing IGN" });
      if (!reason) return res.status(400).json({ ok: false, error: "Missing reason" });

      const durationMs = duration ? Number(duration) * 60 * 1000 : null;
      const result = await banPlayer(ign, reason, req.session.label, durationMs);

      if (result.ok || result.error === "Player is already banned") {
        await sendGameCommand(`ban "${ign}" "${reason}"`).catch(() =>
          sendGameCommand(`global.ban "${ign}" "${reason}"`),
        );
        await audit(req, "ban", { ign, reason, duration: duration || 0 });
      }

      res.json(result.ok ? result : { ...result, ok: result.error === "Player is already banned" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/admin/api/bans/:ign", requireAuth, requirePerm("ban"), async (req, res) => {
    try {
      const { reason } = req.body ?? {};
      const result = await unbanPlayer(req.params.ign, req.session.label, reason || "Unbanned");

      if (result.ok) {
        await sendGameCommand(`unban "${req.params.ign}"`).catch(() =>
          sendGameCommand(`global.unban "${req.params.ign}"`),
        );
        await audit(req, "unban", { ign: req.params.ign, reason: reason || "Unbanned" });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // ——— Scheduled Events ———
  const {
    createEvent,
    updateEvent,
    deleteEvent,
    getAllEvents,
    runEventNow,
  } = await import("../../modules/scheduler/engine.js");
  
  app.get("/admin/api/events", requireAuth, requirePerm("schedule"), async (_req, res) => {
    try {
      const events = await getAllEvents();
      res.json({ ok: true, events });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
  
  app.post("/admin/api/events", requireAuth, requirePerm("schedule"), async (req, res) => {
    try {
      const { name, command, schedule, oneTime } = req.body ?? {};
      if (!name) return res.status(400).json({ ok: false, error: "Missing name" });
      if (!command) return res.status(400).json({ ok: false, error: "Missing command" });
      if (!schedule) return res.status(400).json({ ok: false, error: "Missing schedule" });
      
      const result = await createEvent(name, command, schedule, req.session.label, oneTime);
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
  
  app.patch("/admin/api/events/:id", requireAuth, requirePerm("schedule"), async (req, res) => {
    try {
      const result = await updateEvent(req.params.id, req.body, req.session.label);
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
  
  app.delete("/admin/api/events/:id", requireAuth, requirePerm("schedule"), async (req, res) => {
    try {
      const result = await deleteEvent(req.params.id, req.session.label);
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
  
  app.post("/admin/api/events/:id/run", requireAuth, requirePerm("schedule"), async (req, res) => {
    try {
      const result = await runEventNow(req.params.id, req.session.label);
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

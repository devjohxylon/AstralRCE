import crypto from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../../config.js";
import { getBotStatus } from "../../services/discordPublish.js";
import {
  getOnlinePlayers,
  getRconStatus,
  getServerInfo,
  sendGameCommand,
} from "../../modules/rcon/client.js";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_HTML = readFileSync(path.join(__dirname, "panel.html"), "utf8");

function cookieToken() {
  return crypto
    .createHmac("sha256", config.adminPanel.password)
    .update("astral-admin-v1")
    .digest("hex");
}

function parseCookies(req) {
  const header = req.get("cookie") ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return i === -1 ? [p, ""] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      }),
  );
}

function isAuthed(req) {
  const cookies = parseCookies(req);
  return cookies.astral_admin === cookieToken();
}

function requireAuth(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Unauthorized" });
  return next();
}

function setAuthCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `astral_admin=${cookieToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
  );
}

function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", "astral_admin=; Path=/; HttpOnly; Max-Age=0");
}

export function attachAdminPanel(app, client) {
  // Bare domain → panel (avoids Express "Cannot GET /")
  app.get("/", (_req, res) => res.redirect(302, "/admin"));

  app.get("/admin", (_req, res) => {
    res.type("html").send(PANEL_HTML);
  });

  app.get("/admin/", (_req, res) => res.redirect("/admin"));

  app.post("/admin/api/login", (req, res) => {
    const password = String(req.body?.password ?? "");
    if (!password || password !== config.adminPanel.password) {
      return res.status(401).json({ ok: false, error: "Wrong password" });
    }
    setAuthCookie(res);
    return res.json({ ok: true });
  });

  app.post("/admin/api/logout", (_req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  app.get("/admin/api/session", (req, res) => {
    res.json({ ok: true, authed: isAuthed(req) });
  });

  app.get("/admin/api/overview", requireAuth, async (_req, res) => {
    const info = getServerInfo();
    const rcon = getRconStatus();
    const bot = await getBotStatus(client);
    const stats = await statsSummary();
    const players = getOnlinePlayers();

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
    });
  });

  app.get("/admin/api/players", requireAuth, async (_req, res) => {
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

  app.post("/admin/api/rcon", requireAuth, async (req, res) => {
    try {
      const command = String(req.body?.command ?? "").trim();
      if (!command) return res.status(400).json({ ok: false, error: "Missing command" });
      const result = await sendGameCommand(command);
      res.json({ ok: true, result: result ?? "" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/broadcast", requireAuth, async (req, res) => {
    try {
      const message = String(req.body?.message ?? "").trim();
      if (!message) return res.status(400).json({ ok: false, error: "Missing message" });
      const result = await sendGameCommand(`say <color=#00ffcc>[Astral]</color> ${message}`);
      res.json({ ok: true, result: result ?? "" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/players/:ign/kick", requireAuth, async (req, res) => {
    try {
      const reason = String(req.body?.reason ?? "Kicked by admin");
      const result = await sendGameCommand(`kick "${req.params.ign}" "${reason}"`);
      res.json({ ok: true, result: result ?? "" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/players/:ign/ban", requireAuth, async (req, res) => {
    try {
      const reason = String(req.body?.reason ?? "Banned by admin");
      const result = await sendGameCommand(`ban "${req.params.ign}" "${reason}"`);
      res.json({ ok: true, result: result ?? "" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/api/players/:ign/teleport", requireAuth, async (req, res) => {
    try {
      const { x, y, z, toPlayer } = req.body ?? {};
      if (toPlayer) {
        const pos = await getPlayerPosition(toPlayer);
        await teleportPlayer(req.params.ign, pos);
        return res.json({ ok: true, pos });
      }
      if (x == null || y == null || z == null) {
        return res.status(400).json({ ok: false, error: "Need x,y,z or toPlayer" });
      }
      await teleportPlayer(req.params.ign, { x: Number(x), y: Number(y), z: Number(z) });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/admin/api/stats", requireAuth, async (req, res) => {
    const category = String(req.query.category ?? "kills");
    const rows = await getLeaderboard(category, 25);
    const summary = await statsSummary();
    res.json({ ok: true, category, rows, summary });
  });

  app.get("/admin/api/stats/:name", requireAuth, async (req, res) => {
    const card = await getPlayerCard(req.params.name);
    if (!card) return res.status(404).json({ ok: false, error: "Player not found" });
    res.json({ ok: true, player: card });
  });

  app.post("/admin/api/stats/reset", requireAuth, async (req, res) => {
    const label = req.body?.label;
    const data = await resetStats(label);
    res.json({ ok: true, wipe: data.wipe });
  });

  app.post("/admin/api/stats/push", requireAuth, async (_req, res) => {
    try {
      const result = await pushLeaderboardToWebsite();
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/admin/api/links", requireAuth, async (_req, res) => {
    res.json({ ok: true, links: await listLinks() });
  });

  app.post("/admin/api/links", requireAuth, async (req, res) => {
    const { discordId, ign } = req.body ?? {};
    if (!discordId || !ign) return res.status(400).json({ ok: false, error: "Need discordId + ign" });
    const result = await forceLink(String(discordId), String(ign));
    res.json({ ok: true, ...result });
  });

  app.delete("/admin/api/links/:discordId", requireAuth, async (req, res) => {
    const result = await unlinkDiscord(req.params.discordId);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.get("/admin/api/warps", requireAuth, async (_req, res) => {
    const data = await import("../../data/store.js").then((m) => m.getHomes());
    res.json({ ok: true, warps: data.warps ?? {}, names: await listWarps() });
  });

  app.post("/admin/api/warps", requireAuth, async (req, res) => {
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
      res.json({ ok: true, name: String(name).toLowerCase(), pos });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/admin/api/warps/:name", requireAuth, async (req, res) => {
    const result = await deleteWarp(req.params.name);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.get("/admin/api/automessages", requireAuth, async (_req, res) => {
    res.json({ ok: true, messages: await listAutoMessages() });
  });

  app.post("/admin/api/automessages", requireAuth, async (req, res) => {
    const { text, intervalMinutes } = req.body ?? {};
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });
    const message = await addAutoMessage(text, intervalMinutes);
    res.json({ ok: true, message });
  });

  app.patch("/admin/api/automessages/:id", requireAuth, async (req, res) => {
    const result = await updateAutoMessage(req.params.id, req.body ?? {});
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/admin/api/automessages/:id/toggle", requireAuth, async (req, res) => {
    const result = await toggleAutoMessage(req.params.id, Boolean(req.body?.enabled));
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.delete("/admin/api/automessages/:id", requireAuth, async (req, res) => {
    const result = await removeAutoMessage(req.params.id);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.get("/admin/api/schedule", requireAuth, async (_req, res) => {
    res.json({ ok: true, jobs: await listScheduledCommands() });
  });

  app.post("/admin/api/schedule", requireAuth, async (req, res) => {
    const { name, command, intervalMinutes } = req.body ?? {};
    if (!command) return res.status(400).json({ ok: false, error: "Missing command" });
    const job = await addScheduledCommand({ name, command, intervalMinutes });
    res.json({ ok: true, job });
  });

  app.patch("/admin/api/schedule/:id", requireAuth, async (req, res) => {
    const result = await updateScheduledCommand(req.params.id, req.body ?? {});
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/admin/api/schedule/:id/toggle", requireAuth, async (req, res) => {
    const result = await toggleScheduledCommand(req.params.id, Boolean(req.body?.enabled));
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  app.post("/admin/api/schedule/:id/run", requireAuth, async (req, res) => {
    try {
      const result = await runScheduledCommandNow(req.params.id);
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.delete("/admin/api/schedule/:id", requireAuth, async (req, res) => {
    const result = await removeScheduledCommand(req.params.id);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });
}

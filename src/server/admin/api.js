import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
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
import {
  deleteKit,
  giveKit,
  listKits,
  upsertKit,
} from "../../modules/rcon/kits.js";
import { getWipeAt, setWipeAt, syncWipeStatus } from "../../modules/rcon/wipe.js";
import {
  STAFF_PERMISSIONS,
  appendPanelLog,
  authenticateAccessKey,
  clearSessionCookie,
  createAccessKey,
  getSession,
  hasPerm,
  listAccessKeys,
  listPanelLogs,
  revokeAccessKey,
  setSessionCookie,
  updateAccessKey,
} from "../../modules/admin/access-keys.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANEL_HTML = readFileSync(path.join(__dirname, "panel.html"), "utf8");

function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  req.session = session;
  return next();
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

export function attachAdminPanel(app, client) {
  app.get("/", (_req, res) => res.redirect(302, "/admin"));

  app.get("/admin", (_req, res) => {
    res.type("html").send(PANEL_HTML);
  });

  app.get("/admin/", (_req, res) => res.redirect("/admin"));

  app.post("/admin/api/login", async (req, res) => {
    const password = String(req.body?.password ?? "");
    const session = await authenticateAccessKey(password);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Wrong access key" });
    }
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
    const session = getSession(req);
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

  app.get("/admin/api/session", (req, res) => {
    const session = getSession(req);
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
      const result = await sendGameCommand(`ban "${req.params.ign}" "${reason}"`);
      await audit(req, "ban", { ign: req.params.ign, reason });
      res.json({ ok: true, result: result ?? "" });
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
      await audit(req, "stats_push");
      res.json({ ok: true, result });
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
  app.get("/admin/api/kits", requireAuth, requirePerm("kits"), async (_req, res) => {
    res.json({ ok: true, kits: await listKits() });
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
      if (!ign) return res.status(400).json({ ok: false, error: "Missing player IGN" });
      const result = await giveKit(ign, req.params.id);
      await audit(req, "kit_give", { id: req.params.id, ign, given: result.given });
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
}

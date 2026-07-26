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
import { listRustItems } from "../../data/rust-items.js";
import {
  deleteKit,
  giveKit,
  listKits,
  listServerKits,
  upsertKit,
} from "../../modules/rcon/kits.js";
import { getWipeAt, setWipeAt, syncWipeStatus } from "../../modules/rcon/wipe.js";
import {
  EVENT_PRESETS,
  RANK_PRESETS,
  getChannelConfig,
  saveChannelConfig,
} from "../../modules/admin/channel-settings.js";
import { listReports, scanAllTeams, searchCombat } from "../../modules/rcon/reports.js";
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
            mapSeed: info.Seed ?? null,
            mapSize: info.WorldSize ?? 4000,
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
  app.get("/admin/api/items", requireAuth, requirePerm("kits"), (req, res) => {
    const q = String(req.query.q ?? "");
    const category = String(req.query.category ?? "");
    res.json({ ok: true, ...listRustItems({ q, category }) });
  });

  app.get("/admin/api/kits", requireAuth, requirePerm("kits"), async (req, res) => {
    const refresh = String(req.query.refresh ?? "1") !== "0";
    const panel = await listKits();
    const server = await listServerKits({ refresh }).catch((error) => ({
      ok: false,
      error: error.message,
      kits: [],
    }));
    res.json({
      ok: true,
      kits: panel,
      serverKits: server.kits || [],
      serverOk: server.ok !== false,
      serverError: server.error || null,
    });
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

  // ——— Server Commands: channels / ranks / events ———
  app.get("/admin/api/server-commands", requireAuth, requirePerm("serverCommands"), async (_req, res) => {
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

    const online = getOnlinePlayers().map((p) => p.ign);
    const panelKits = await listKits();
    const server = await listServerKits({ refresh: false }).catch(() => ({ kits: [] }));
    const allKits = [
      ...panelKits.map((k) => ({ ...k, optLabel: `${k.label} [panel]` })),
      ...(server.kits || []).map((k) => ({ ...k, optLabel: `${k.label} [server]` })),
    ];
    res.json({
      ok: true,
      channels: await getChannelConfig(),
      discordChannels,
      kits: allKits,
      events: EVENT_PRESETS,
      ranks: RANK_PRESETS.map((r) => ({ id: r.id, label: r.label })),
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

  app.post("/admin/api/events", requireAuth, requirePerm("serverCommands"), async (req, res) => {
    try {
      const id = String(req.body?.id ?? "").trim();
      const custom = String(req.body?.command ?? "").trim();
      const preset = EVENT_PRESETS.find((e) => e.id === id);
      const command = custom || preset?.command;
      if (!command) return res.status(400).json({ ok: false, error: "Pick an event or enter a command" });

      const result = await sendGameCommand(command);
      await audit(req, "event_trigger", { id: id || null, command });
      res.json({ ok: true, result: result ?? "", command });
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
      res.json({ ok: true, profile });
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
}

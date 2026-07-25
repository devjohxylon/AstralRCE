import express from "express";
import { config } from "../config.js";
import { publishFromWebsite, getBotStatus } from "../services/discordPublish.js";
import { backfillChannel, syncLatestLeaderboard } from "../services/website.js";
import { attachAdminPanel } from "./admin/api.js";

function authorize(req, res, next) {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;

  if (!token || token !== config.webhook.secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}

export function createWebhookServer(client) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  attachAdminPanel(app, client);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, discordReady: client.isReady() });
  });

  app.get("/status", authorize, async (_req, res) => {
    res.json(await getBotStatus(client));
  });

  app.post("/publish", authorize, async (req, res) => {
    try {
      const result = await publishFromWebsite(client, req.body ?? {});
      res.status(201).json({ ok: true, ...result });
    } catch (error) {
      console.error("Publish webhook failed:", error);
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/sync/leaderboard", authorize, async (_req, res) => {
    try {
      const messageIds = await syncLatestLeaderboard(client);
      res.json({ ok: true, synced: messageIds.length, messageIds });
    } catch (error) {
      console.error("Leaderboard sync failed:", error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/sync/backfill", authorize, async (req, res) => {
    try {
      const { channelId, limit = 25 } = req.body ?? {};
      const targetId = channelId || config.channels.kaosActivity;

      if (!targetId) {
        return res.status(400).json({ ok: false, error: "No channel configured for backfill" });
      }

      const channel = client.channels.cache.get(targetId);
      if (!channel?.isTextBased()) {
        return res.status(404).json({ ok: false, error: `Channel ${targetId} not found` });
      }

      const messageIds = await backfillChannel(channel, Math.min(Number(limit) || 25, 100));
      res.json({ ok: true, synced: messageIds.length, messageIds });
    } catch (error) {
      console.error("Backfill failed:", error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  return app;
}

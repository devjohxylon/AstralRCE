import { listPanelLogs } from "./access-keys.js";
import { getAuditEntries } from "../audit/logger.js";
import { getAllBans } from "../bans/manager.js";
import { getTickets, getSettings } from "../../data/store.js";
import { listReports } from "../rcon/reports.js";
import { listLinks } from "../rcon/linking.js";

function pushItem(items, item) {
  if (!item?.at) return;
  items.push(item);
}

function combatSpikes(combat, windowMs = 10 * 60_000, minKills = 5) {
  const byKiller = new Map();
  for (const e of combat || []) {
    if (!e?.pvp || !e.killer || e.killer === e.victim) continue;
    const key = String(e.killer).toLowerCase();
    if (!byKiller.has(key)) byKiller.set(key, []);
    byKiller.get(key).push(e);
  }
  const spikes = [];
  for (const [, events] of byKiller) {
    const sorted = events.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
    for (let i = 0; i < sorted.length; i++) {
      const start = new Date(sorted[i].at).getTime();
      let n = 1;
      for (let j = i + 1; j < sorted.length; j++) {
        if (start - new Date(sorted[j].at).getTime() <= windowMs) n += 1;
        else break;
      }
      if (n >= minKills) {
        spikes.push({
          ign: sorted[i].killer,
          count: n,
          at: sorted[i].at,
          windowMin: Math.round(windowMs / 60000),
        });
        break;
      }
    }
  }
  return spikes;
}

/** Unified staff moderation feed. */
export async function buildInbox({ limit = 60 } = {}) {
  const n = Math.min(100, Math.max(10, Number(limit) || 60));
  const items = [];

  const [panelLogs, audit, bans, tickets, settings, links] = await Promise.all([
    listPanelLogs(40).catch(() => []),
    getAuditEntries({ limit: 40 }).catch(() => []),
    getAllBans({ includeInactive: true, limit: 40 }).catch(() => []),
    getTickets().catch(() => ({ open: [], closed: [] })),
    getSettings().catch(() => ({})),
    listLinks().catch(() => []),
  ]);

  const reports = listReports({ limit: 40 });
  const linkByDiscord = Object.fromEntries(links.map((l) => [String(l.discordId), l]));

  for (const g of reports.groups || []) {
    pushItem(items, {
      id: `group:${g.id}`,
      at: g.at,
      kind: "group",
      severity: "bad",
      title: `Trio limit ${g.size}/${g.max}`,
      detail: (g.members || []).join(", ") || `Team #${g.teamId}`,
      igns: g.members || [],
    });
  }

  for (const spike of combatSpikes(reports.combat)) {
    pushItem(items, {
      id: `spike:${spike.ign}:${spike.at}`,
      at: spike.at,
      kind: "combat_spike",
      severity: "warn",
      title: `Combat spike · ${spike.count} kills / ${spike.windowMin}m`,
      detail: spike.ign,
      igns: [spike.ign],
    });
  }

  for (const c of (reports.combat || []).slice(0, 15)) {
    if (!c.pvp) continue;
    pushItem(items, {
      id: `combat:${c.id}`,
      at: c.at,
      kind: "combat",
      severity: c.headshot ? "info" : "info",
      title: `${c.killer} → ${c.victim}`,
      detail: [c.weapon, c.headshot ? "HS" : null, c.distance != null ? `${c.distance}m` : null]
        .filter(Boolean)
        .join(" · ") || "PvP",
      igns: [c.killer, c.victim].filter(Boolean),
    });
  }

  for (const t of tickets.open || []) {
    const link = linkByDiscord[String(t.userId)];
    pushItem(items, {
      id: `ticket:${t.id}`,
      at: t.createdAt,
      kind: "ticket",
      severity: t.type === "report" || t.type === "appeal" ? "warn" : "info",
      title: `Open ticket · ${t.type || "general"}`,
      detail: link?.ign ? `${link.ign} · Discord ${t.userId}` : `Discord ${t.userId}`,
      igns: link?.ign ? [link.ign] : [],
      discordId: t.userId,
    });
  }

  for (const b of bans) {
    pushItem(items, {
      id: `ban:${b.id || b.ign}:${b.bannedAt}`,
      at: b.bannedAt || b.unbannedAt,
      kind: b.active ? "ban" : "unban",
      severity: b.active ? "bad" : "info",
      title: b.active ? `Banned · ${b.ign}` : `Unbanned · ${b.ign}`,
      detail: b.active
        ? `${b.reason || "—"} · by ${b.admin || "—"}`
        : `${b.unbanReason || "—"} · by ${b.unbannedBy || "—"}`,
      igns: b.ign ? [b.ign] : [],
    });
  }

  for (const a of audit) {
    if (!["ban_player", "unban_player"].includes(a.action)) continue;
    // Already covered by bans list; skip duplicates unless undoable marker useful
  }

  for (const e of panelLogs) {
    if (!["kick", "ban", "unban", "kit_give", "rank_grant", "rank_revoke", "player_warning_add"].includes(e.action)) {
      continue;
    }
    const ign = e.detail?.ign || e.detail?.player || null;
    pushItem(items, {
      id: `panel:${e.id}`,
      at: e.at,
      kind: "staff",
      severity: e.action === "ban" || e.action === "kick" ? "warn" : "info",
      title: `${e.action.replace(/_/g, " ")} · ${e.by || "staff"}`,
      detail: ign
        ? `${ign}${e.detail?.reason ? ` · ${e.detail.reason}` : ""}`
        : JSON.stringify(e.detail || {}).slice(0, 80),
      igns: ign ? [ign] : [],
    });
  }

  const raidAlerts = Array.isArray(settings.raidAlerts) ? settings.raidAlerts : [];
  for (const r of raidAlerts.slice(0, 10)) {
    pushItem(items, {
      id: `raid:${r.id || r.at}`,
      at: r.at,
      kind: "raid",
      severity: "bad",
      title: "Discord raid join spike",
      detail: `${r.joinCount} joins in ${r.windowSeconds || "?"}s`,
      igns: [],
    });
  }

  items.sort((a, b) => new Date(b.at) - new Date(a.at));

  // Dedupe near-identical ban lines
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${item.kind}:${item.title}:${item.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= n) break;
  }

  return {
    ok: true,
    items: deduped,
    counts: {
      group: deduped.filter((i) => i.kind === "group").length,
      ticket: deduped.filter((i) => i.kind === "ticket").length,
      ban: deduped.filter((i) => i.kind === "ban").length,
      raid: deduped.filter((i) => i.kind === "raid").length,
      spike: deduped.filter((i) => i.kind === "combat_spike").length,
    },
  };
}

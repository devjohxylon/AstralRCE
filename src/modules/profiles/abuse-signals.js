import { isWorldActorName } from "../rcon/stats.js";

/**
 * Heuristic abuse / watch signals for staff dossiers. Never auto-bans.
 */
export function buildAbuseSignals({
  ign,
  banHistory = [],
  tickets = { open: [], closed: [] },
  recentKills = [],
  profile = {},
  link = null,
  groupAppearances = [],
} = {}) {
  const signals = [];
  const player = String(ign || "").trim();
  const playerKey = player.toLowerCase();

  const asKiller = (recentKills || []).filter(
    (k) =>
      k?.pvp &&
      String(k.killer || "").toLowerCase() === playerKey &&
      !isWorldActorName(k.killer) &&
      !isWorldActorName(k.victim),
  );

  if (asKiller.length >= 8) {
    const hs = asKiller.filter((k) => k.headshot).length;
    const rate = hs / asKiller.length;
    if (rate >= 0.7) {
      signals.push({
        id: "headshot_rate",
        severity: "warn",
        label: `High HS rate ${(rate * 100).toFixed(0)}%`,
        detail: `${hs}/${asKiller.length} recent kills headshot`,
      });
    }
  }

  const longShots = asKiller.filter((k) => Number(k.distance) >= 180);
  if (longShots.length >= 3) {
    signals.push({
      id: "distance_spikes",
      severity: "warn",
      label: `${longShots.length} long-range kills`,
      detail: `≥180m in recent combat (max ${Math.max(...longShots.map((k) => Number(k.distance) || 0))}m)`,
    });
  }

  const teamIds = new Set(
    (groupAppearances || [])
      .filter((g) => (g.members || []).some((m) => String(m).toLowerCase() === playerKey))
      .map((g) => String(g.teamId)),
  );
  if (teamIds.size >= 2) {
    signals.push({
      id: "team_hopping",
      severity: "warn",
      label: "Duo/trio hopping",
      detail: `Seen in ${teamIds.size} different oversized teams recently`,
    });
  }

  const prev = Array.isArray(link?.previousIgns) ? link.previousIgns : [];
  if (prev.length >= 1) {
    const names = prev.map((p) => (typeof p === "string" ? p : p.ign)).filter(Boolean);
    signals.push({
      id: "multi_ign",
      severity: prev.length >= 2 ? "bad" : "warn",
      label: `Discord linked ${prev.length + 1} IGNs`,
      detail: [player, ...names].slice(0, 5).join(" → "),
    });
  }

  const warnings = profile.warnings || [];
  if (warnings.length >= 3) {
    signals.push({
      id: "warning_stack",
      severity: "warn",
      label: `${warnings.length} warnings`,
      detail: "Stacked staff warnings on dossier",
    });
  }

  const bans = banHistory || [];
  const activeBan = bans.some((b) => b.active);
  if (activeBan) {
    signals.push({
      id: "active_ban",
      severity: "bad",
      label: "Currently banned",
      detail: bans.find((b) => b.active)?.reason || "Active ban",
    });
  } else if (bans.length >= 2) {
    signals.push({
      id: "repeat_bans",
      severity: "warn",
      label: `${bans.length} past bans`,
      detail: "Repeat ban history",
    });
  }

  const openTickets = tickets.open || [];
  if (openTickets.some((t) => t.type === "appeal")) {
    signals.push({
      id: "open_appeal",
      severity: "info",
      label: "Open ban appeal",
      detail: "Player has an open appeal ticket",
    });
  }
  if (openTickets.some((t) => t.type === "report")) {
    signals.push({
      id: "open_report",
      severity: "info",
      label: "Open report ticket",
      detail: "Player has an open report ticket",
    });
  }

  const tags = (profile.tags || []).map((t) => String(t).toLowerCase());
  for (const tag of ["cheater", "toxic", "watch", "sus"]) {
    if (tags.includes(tag)) {
      signals.push({
        id: `tag_${tag}`,
        severity: tag === "cheater" ? "bad" : "warn",
        label: `Tag · ${tag}`,
        detail: "Staff tag on profile",
      });
    }
  }

  return signals;
}

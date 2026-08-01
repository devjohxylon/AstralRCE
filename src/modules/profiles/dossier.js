import { getTickets } from "../../data/store.js";
import { getLinkByDiscord, getLinkByIgn, listLinks } from "../rcon/linking.js";
import { findVipClaim } from "../rcon/vip-claims.js";
import { playerHasDiscordVip } from "../rcon/vip-sync.js";
import { listReports, searchCombat } from "../rcon/reports.js";
import { getOnlinePlayers } from "../rcon/client.js";
import { getBanHistory, isPlayerBanned } from "../bans/manager.js";
import { getPlayerProfile, searchPlayers } from "./manager.js";
import { buildAbuseSignals } from "./abuse-signals.js";

function mapTicketSummary(t) {
  return {
    id: t.id,
    type: t.type,
    channelId: t.channelId || null,
    createdAt: t.createdAt || null,
    closedAt: t.closedAt || null,
    closedBy: t.closedBy || null,
    status: t.status || "open",
  };
}

async function listTicketsForDiscord(discordId) {
  if (!discordId) return { open: [], closed: [] };
  const data = await getTickets().catch(() => ({ open: [], closed: [] }));
  const uid = String(discordId);
  const open = (data.open || [])
    .filter((t) => String(t.userId) === uid)
    .map(mapTicketSummary);
  const closed = (data.closed || [])
    .filter((t) => String(t.userId) === uid)
    .slice(0, 40)
    .map(mapTicketSummary);
  return { open, closed };
}

/**
 * Resolve a query (IGN or Discord snowflake) to a best-match IGN.
 */
export async function resolveDossierQuery(query) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, error: "Missing query" };

  const online = getOnlinePlayers();
  const exactOnline = online.find((p) => p.ign.toLowerCase() === q.toLowerCase());
  if (exactOnline) return { ok: true, ign: exactOnline.ign };

  if (/^\d{5,32}$/.test(q)) {
    const byDiscord = await getLinkByDiscord(q);
    if (byDiscord?.ign) return { ok: true, ign: byDiscord.ign, discordId: q };
  }

  const byIgn = await getLinkByIgn(q);
  if (byIgn?.ign) return { ok: true, ign: byIgn.ign, discordId: byIgn.discordId };

  const links = await listLinks();
  const linkHit = links.find(
    (l) =>
      String(l.ign).toLowerCase() === q.toLowerCase() ||
      String(l.discordId) === q ||
      String(l.ign).toLowerCase().includes(q.toLowerCase()),
  );
  if (linkHit) return { ok: true, ign: linkHit.ign, discordId: linkHit.discordId };

  const profiles = await searchPlayers(q);
  if (profiles.length === 1) return { ok: true, ign: profiles[0].ign };
  if (profiles.length > 1) {
    return {
      ok: true,
      ambiguous: true,
      matches: profiles.slice(0, 20).map((p) => ({
        ign: p.ign,
        tags: p.tags || [],
      })),
    };
  }

  const partialOnline = online.filter((p) =>
    p.ign.toLowerCase().includes(q.toLowerCase()),
  );
  if (partialOnline.length === 1) return { ok: true, ign: partialOnline[0].ign };
  if (partialOnline.length > 1) {
    return {
      ok: true,
      ambiguous: true,
      matches: partialOnline.slice(0, 20).map((p) => ({ ign: p.ign })),
    };
  }

  return { ok: true, ign: q };
}

/** Full staff dossier for one player. */
export async function buildDossier(ign) {
  const displayIgn = String(ign || "").trim();
  if (!displayIgn) return { ok: false, error: "Missing IGN" };

  const profile = await getPlayerProfile(displayIgn);
  const resolvedIgn = profile.ign || displayIgn;
  const link = profile.link || (await getLinkByIgn(resolvedIgn).catch(() => null));
  const discordId = link?.discordId || null;

  const [banHistory, banned, tickets, vipRole, vipClaim] = await Promise.all([
    getBanHistory(resolvedIgn).catch(() => []),
    isPlayerBanned(resolvedIgn).catch(() => false),
    listTicketsForDiscord(discordId),
    playerHasDiscordVip(resolvedIgn).catch(() => false),
    findVipClaim({ ign: resolvedIgn, discordId }).catch(() => null),
  ]);

  const recentKills = searchCombat(resolvedIgn, 40);
  const groupAppearances = listReports({ limit: 40 }).groups || [];

  const linkPayload = link
    ? {
        discordId: link.discordId,
        linkedAt: link.linkedAt,
        forced: Boolean(link.forced),
        previousIgns: Array.isArray(link.previousIgns) ? link.previousIgns : [],
      }
    : null;

  const signals = buildAbuseSignals({
    ign: resolvedIgn,
    banHistory,
    tickets,
    recentKills,
    profile,
    link: linkPayload,
    groupAppearances,
  });

  return {
    ok: true,
    ign: resolvedIgn,
    profile,
    link: linkPayload,
    vip: {
      hasDiscordRole: Boolean(vipRole),
      claim: vipClaim
        ? {
            at: vipClaim.at,
            kitId: vipClaim.kitId,
            wipeId: vipClaim.wipeId,
            by: vipClaim.by,
          }
        : null,
    },
    bans: {
      active: Boolean(banned) || banHistory.some((b) => b.active),
      history: banHistory,
    },
    tickets: {
      open: tickets.open,
      closed: tickets.closed,
    },
    signals,
    stats: profile.stats || null,
    activity: profile.activity || null,
    recentKills,
    online: profile.online || null,
  };
}

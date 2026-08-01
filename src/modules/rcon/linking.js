import { config } from "../../config.js";
import { getLinks, saveLinks } from "../../data/store.js";
import { getOnlinePlayers } from "./client.js";

let discordClient = null;

export function attachLinkClient(client) {
  discordClient = client;
}

export async function getLinkByDiscord(discordId) {
  const data = await getLinks();
  return data.byDiscord[discordId] ?? null;
}

export async function getLinkByIgn(ign) {
  const data = await getLinks();
  const key = Object.keys(data.byIgn).find((n) => n.toLowerCase() === ign.toLowerCase());
  if (!key) return null;
  const row = data.byIgn[key];
  const discordRow = row.discordId ? data.byDiscord[row.discordId] : null;
  return {
    ign: key,
    ...row,
    previousIgns: Array.isArray(discordRow?.previousIgns)
      ? discordRow.previousIgns
      : [],
  };
}

export async function listLinks() {
  const data = await getLinks();
  return Object.entries(data.byDiscord).map(([discordId, link]) => ({
    discordId,
    ign: link.ign,
    linkedAt: link.linkedAt,
    forced: Boolean(link.forced),
    previousIgns: Array.isArray(link.previousIgns) ? link.previousIgns : [],
  }));
}

function withPreviousIgns(existing, nextIgn) {
  const history = Array.isArray(existing?.previousIgns) ? [...existing.previousIgns] : [];
  const prev = existing?.ign;
  if (prev && String(prev).toLowerCase() !== String(nextIgn).toLowerCase()) {
    history.unshift({
      ign: prev,
      at: existing.linkedAt || new Date().toISOString(),
    });
  }
  return history.slice(0, 20);
}

export async function requireLinkedIgn(discordId) {
  const link = await getLinkByDiscord(discordId);
  if (!link) {
    return {
      ok: false,
      error: "Not linked yet. Use the **Link Account** panel or `/link start` with your IGN.",
    };
  }
  return { ok: true, ign: link.ign, link };
}

export function findOnlinePlayer(ign) {
  const online = getOnlinePlayers();
  return online.find((p) => p.ign.toLowerCase() === ign.toLowerCase()) ?? null;
}

async function fetchGuild() {
  if (!discordClient) return null;
  return config.discord.guildId
    ? discordClient.guilds.fetch(config.discord.guildId).catch(() => null)
    : discordClient.guilds.cache.first() || null;
}

async function fetchGuildMember(discordId) {
  if (!discordId) return null;
  const guild = await fetchGuild();
  if (!guild) return null;
  return guild.members.fetch(String(discordId)).catch(() => null);
}

/**
 * Resolve ROLE_LINKED to a snowflake.
 * Accepts a role ID or a role name (e.g. "linkedastral").
 */
async function resolveLinkedRoleId(guild = null) {
  const raw = String(config.roles.linked || "").trim();
  if (!raw) return { ok: false, error: "ROLE_LINKED is not set" };

  if (/^\d{5,32}$/.test(raw)) {
    return { ok: true, roleId: raw };
  }

  const g = guild || (await fetchGuild());
  if (!g) return { ok: false, error: "Discord guild not ready" };

  if (!g.roles.cache.size) {
    await g.roles.fetch().catch(() => null);
  }

  const wanted = raw.toLowerCase();
  const role =
    g.roles.cache.find((r) => String(r.name || "").toLowerCase() === wanted) ||
    g.roles.cache.find((r) => String(r.name || "").toLowerCase().includes(wanted));

  if (!role) {
    return {
      ok: false,
      error: `No Discord role named "${raw}" — set ROLE_LINKED to the role ID (right-click role → Copy Role ID)`,
    };
  }
  return { ok: true, roleId: role.id, roleName: role.name };
}

/** Give ROLE_LINKED after a successful account link. */
export async function grantLinkedRole(discordId, member = null) {
  const m = member || (await fetchGuildMember(discordId));
  if (!m) return { ok: false, error: "Member not found" };

  const resolved = await resolveLinkedRoleId(m.guild);
  if (!resolved.ok) {
    if (resolved.error === "ROLE_LINKED is not set") {
      return { ok: true, skipped: true, reason: "no_role" };
    }
    return { ok: false, error: resolved.error };
  }

  const roleId = resolved.roleId;
  if (m.roles.cache.has(roleId)) return { ok: true, already: true };

  await m.roles.add(roleId, "Linked in-game account");
  return { ok: true, roleId };
}

/** Remove ROLE_LINKED when someone unlinks (or loses their link via force). */
export async function revokeLinkedRole(discordId, member = null) {
  const m = member || (await fetchGuildMember(discordId));
  if (!m) return { ok: false, error: "Member not found" };

  const resolved = await resolveLinkedRoleId(m.guild);
  if (!resolved.ok) {
    if (resolved.error === "ROLE_LINKED is not set") {
      return { ok: true, skipped: true, reason: "no_role" };
    }
    return { ok: false, error: resolved.error };
  }

  const roleId = resolved.roleId;
  if (!m.roles.cache.has(roleId)) return { ok: true, already: true };

  await m.roles.remove(roleId, "Unlinked in-game account");
  return { ok: true, roleId };
}

/**
 * Grant ROLE_LINKED to everyone currently linked.
 * Safe to re-run — skips people who already have the role.
 */
export async function backfillLinkedRoles() {
  if (!discordClient) {
    return { ok: false, error: "Discord client not ready" };
  }

  const resolved = await resolveLinkedRoleId();
  if (!resolved.ok) return resolved;

  const links = await listLinks();
  const summary = {
    ok: true,
    roleId: resolved.roleId,
    roleName: resolved.roleName || null,
    total: links.length,
    granted: 0,
    already: 0,
    missing: 0,
    failed: 0,
    errors: [],
  };

  for (const link of links) {
    try {
      const result = await grantLinkedRole(link.discordId);
      if (result.skipped) continue;
      if (result.already) {
        summary.already += 1;
      } else if (result.ok) {
        summary.granted += 1;
      } else if (result.error === "Member not found") {
        summary.missing += 1;
      } else {
        summary.failed += 1;
        if (summary.errors.length < 10) {
          summary.errors.push(`${link.ign}: ${result.error || "failed"}`);
        }
      }
    } catch (error) {
      summary.failed += 1;
      if (summary.errors.length < 10) {
        summary.errors.push(`${link.ign}: ${error.message}`);
      }
    }
  }

  return summary;
}

// Instant link: claim an IGN to this Discord account. Online check optional (off by default).
export async function linkIgn(discordId, ign, { requireOnline = false, member = null } = {}) {
  const trimmed = String(ign ?? "").trim();
  if (!trimmed || trimmed.length > 32) {
    return { ok: false, error: "That doesn't look like a valid in-game name." };
  }

  let resolvedName = trimmed;
  if (requireOnline) {
    const online = findOnlinePlayer(trimmed);
    if (!online) {
      return {
        ok: false,
        error: `\`${trimmed}\` isn't online. Join the server, then run \`/link\` with your exact name.`,
      };
    }
    resolvedName = online.ign;
  }

  const data = await getLinks();

  if (data.byDiscord[discordId]?.ign?.toLowerCase() === resolvedName.toLowerCase()) {
    await grantLinkedRole(discordId, member).catch(() => {});
    return { ok: true, ign: data.byDiscord[discordId].ign, already: true };
  }

  if (data.byDiscord[discordId]) {
    return {
      ok: false,
      error: `You're already linked as **${data.byDiscord[discordId].ign}**. Use \`/unlink\` first.`,
    };
  }

  const taken = await getLinkByIgn(resolvedName);
  if (taken && taken.discordId !== discordId) {
    return {
      ok: false,
      error: `\`${resolvedName}\` is already linked to another Discord. Staff can \`/linkadmin force\` if needed.`,
    };
  }

  // Prefer exact casing from the live player list when they're online
  const online = findOnlinePlayer(resolvedName);
  if (online?.ign) resolvedName = online.ign;

  data.byDiscord[discordId] = {
    ign: resolvedName,
    linkedAt: new Date().toISOString(),
  };
  data.byIgn[resolvedName] = {
    discordId,
    linkedAt: new Date().toISOString(),
  };
  delete data.pending?.[discordId];
  await saveLinks(data);

  await grantLinkedRole(discordId, member).catch((e) =>
    console.error("Linked role grant failed:", e.message),
  );

  return { ok: true, ign: resolvedName };
}

export async function unlinkDiscord(discordId, { member = null } = {}) {
  const data = await getLinks();
  const link = data.byDiscord[discordId];
  if (!link) return { ok: false, error: "You're not linked to any in-game name." };

  delete data.byDiscord[discordId];
  delete data.byIgn[link.ign];
  await saveLinks(data);

  await revokeLinkedRole(discordId, member).catch((e) =>
    console.error("Linked role revoke failed:", e.message),
  );

  return { ok: true, ign: link.ign };
}

export async function forceLink(discordId, ign, { member = null } = {}) {
  const data = await getLinks();
  const existing = data.byDiscord[discordId];
  if (existing) delete data.byIgn[existing.ign];

  const taken = await getLinkByIgn(ign);
  const previousOwnerId =
    taken && String(taken.discordId) !== String(discordId) ? taken.discordId : null;
  if (taken) delete data.byDiscord[taken.discordId];

  const previousIgns = withPreviousIgns(existing, ign);
  data.byDiscord[discordId] = {
    ign,
    linkedAt: new Date().toISOString(),
    forced: true,
    previousIgns,
  };
  data.byIgn[ign] = { discordId, linkedAt: new Date().toISOString(), forced: true };
  delete data.pending?.[discordId];
  await saveLinks(data);

  if (previousOwnerId) {
    await revokeLinkedRole(previousOwnerId).catch(() => {});
  }
  await grantLinkedRole(discordId, member).catch((e) =>
    console.error("Linked role grant failed:", e.message),
  );

  return { ok: true, ign };
}

// Legacy no-ops so old imports don't crash during hot reload
export async function startLink(discordId, ign) {
  return linkIgn(discordId, ign);
}

export async function completeLinkFromNote() {
  return null;
}

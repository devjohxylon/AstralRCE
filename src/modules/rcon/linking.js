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
  return key ? { ign: key, ...data.byIgn[key] } : null;
}

export async function listLinks() {
  const data = await getLinks();
  return Object.entries(data.byDiscord).map(([discordId, link]) => ({
    discordId,
    ign: link.ign,
    linkedAt: link.linkedAt,
    forced: Boolean(link.forced),
  }));
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

async function fetchGuildMember(discordId) {
  if (!discordClient || !discordId) return null;
  const guild = config.discord.guildId
    ? await discordClient.guilds.fetch(config.discord.guildId).catch(() => null)
    : discordClient.guilds.cache.first() || null;
  if (!guild) return null;
  return guild.members.fetch(String(discordId)).catch(() => null);
}

/** Give ROLE_LINKED after a successful account link. */
export async function grantLinkedRole(discordId, member = null) {
  const roleId = config.roles.linked;
  if (!roleId) return { ok: true, skipped: true, reason: "no_role" };

  const m = member || (await fetchGuildMember(discordId));
  if (!m) return { ok: false, error: "Member not found" };
  if (m.roles.cache.has(roleId)) return { ok: true, already: true };

  await m.roles.add(roleId, "Linked in-game account");
  return { ok: true };
}

/** Remove ROLE_LINKED when someone unlinks (or loses their link via force). */
export async function revokeLinkedRole(discordId, member = null) {
  const roleId = config.roles.linked;
  if (!roleId) return { ok: true, skipped: true, reason: "no_role" };

  const m = member || (await fetchGuildMember(discordId));
  if (!m) return { ok: false, error: "Member not found" };
  if (!m.roles.cache.has(roleId)) return { ok: true, already: true };

  await m.roles.remove(roleId, "Unlinked in-game account");
  return { ok: true };
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
      error: `\`${resolvedName}\` is already linked to another Discord. Staff can \`/link force\` if needed.`,
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

  data.byDiscord[discordId] = { ign, linkedAt: new Date().toISOString(), forced: true };
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

import { getLinks, saveLinks } from "../../data/store.js";
import { getOnlinePlayers } from "./client.js";

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
      error: "Not linked yet. Join the server and run `/link YourExactIGN`.",
    };
  }
  return { ok: true, ign: link.ign, link };
}

export function findOnlinePlayer(ign) {
  const online = getOnlinePlayers();
  return online.find((p) => p.ign.toLowerCase() === ign.toLowerCase()) ?? null;
}

// Instant link: claim an online IGN to this Discord account. No note codes.
export async function linkIgn(discordId, ign, { requireOnline = true } = {}) {
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

  return { ok: true, ign: resolvedName };
}

export async function unlinkDiscord(discordId) {
  const data = await getLinks();
  const link = data.byDiscord[discordId];
  if (!link) return { ok: false, error: "You're not linked to any in-game name." };

  delete data.byDiscord[discordId];
  delete data.byIgn[link.ign];
  await saveLinks(data);
  return { ok: true, ign: link.ign };
}

export async function forceLink(discordId, ign) {
  const data = await getLinks();
  const existing = data.byDiscord[discordId];
  if (existing) delete data.byIgn[existing.ign];

  const taken = await getLinkByIgn(ign);
  if (taken) delete data.byDiscord[taken.discordId];

  data.byDiscord[discordId] = { ign, linkedAt: new Date().toISOString(), forced: true };
  data.byIgn[ign] = { discordId, linkedAt: new Date().toISOString(), forced: true };
  delete data.pending?.[discordId];
  await saveLinks(data);
  return { ok: true, ign };
}

// Legacy no-ops so old imports don't crash during hot reload
export async function startLink(discordId, ign) {
  return linkIgn(discordId, ign);
}

export async function completeLinkFromNote() {
  return null;
}

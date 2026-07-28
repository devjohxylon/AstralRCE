import { getKits, saveKits } from "../../data/store.js";
import { clearServerKitCache, getRconEndpointKey, getRconStatus, getServer, sendGameCommand } from "./client.js";

const GIVE_DELAY_MS = 120;

/** Last RCON host:port we successfully refreshed kits for */
let kitsEndpointKey = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeId(id) {
  return String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
}

function sanitizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((row) => ({
      item: String(row?.item ?? "")
        .trim()
        .toLowerCase()
        .slice(0, 64),
      amount: Math.max(1, Math.min(100000, Number(row?.amount) || 1)),
    }))
    .filter((row) => row.item && /^[a-z0-9._-]+$/.test(row.item));
}

function parseKitList(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .replaceAll("\\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[KITMANAGER]") && !/^kits?:/i.test(line))
    .map((line) => {
      // Formats like: "vip", "- vip", "vip (Cooldown: 60)", "Kit: vip"
      const cleaned = line
        .replace(/^[-*•]\s*/, "")
        .replace(/^kit[s]?:\s*/i, "")
        .replace(/\s*\(.*\)\s*$/, "")
        .trim();
      return cleaned;
    })
    .filter((name) => name && /^[a-zA-Z0-9._-]+$/.test(name));
}

function parseKitInfoItems(raw) {
  if (!raw || typeof raw !== "string") return [];
  const cleaned = raw.replaceAll("\\n", "\n");
  const items = [];
  const itemRegex =
    /Shortname:\s*(\S+)\s+Amount:\s*\[(\d+)\](?:\s+Condition:\s*\[(\d+)\])?(?:\s+Container:\s*\[(Main|Belt|Wear)\])?/gi;
  let match;
  while ((match = itemRegex.exec(cleaned)) !== null) {
    items.push({
      item: match[1],
      amount: Number(match[2]) || 1,
      condition: match[3] != null ? Number(match[3]) : null,
      container: match[4] || null,
    });
  }
  // Fallback: "wood x1000" / "wood 1000"
  if (!items.length) {
    for (const line of cleaned.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const m = line.match(/^([a-z0-9._-]+)\s*[x×]\s*(\d+)$/i) || line.match(/^([a-z0-9._-]+)\s+(\d+)$/i);
      if (m) items.push({ item: m[1].toLowerCase(), amount: Number(m[2]) || 1 });
    }
  }
  return items;
}

export async function listKits() {
  const data = await getKits();
  return Object.entries(data.kits || {}).map(([id, kit]) => ({
    id,
    label: kit.label || id,
    source: "panel",
    cooldownMinutes: Number(kit.cooldownMinutes) || 0,
    items: Array.isArray(kit.items) ? kit.items : [],
    updatedAt: kit.updatedAt || null,
  }));
}

export async function getKit(id) {
  const key = normalizeId(id);
  if (!key) return null;
  const data = await getKits();
  const kit = data.kits?.[key];
  if (!kit) return null;
  return {
    id: key,
    label: kit.label || key,
    source: "panel",
    cooldownMinutes: Number(kit.cooldownMinutes) || 0,
    items: Array.isArray(kit.items) ? kit.items : [],
    updatedAt: kit.updatedAt || null,
  };
}

/**
 * Fetch kits defined on the Rust server (KitManager / Oxide kits).
 * Never reuse kits from a different RCON endpoint after a server switch.
 */
export async function listServerKits({ refresh = true, detail = false } = {}) {
  const endpointKey = getRconEndpointKey();
  const server = getServer();

  if (kitsEndpointKey && endpointKey && kitsEndpointKey !== endpointKey) {
    clearServerKitCache();
    kitsEndpointKey = null;
  }

  const cached = server?.kits;
  let names = [];

  if (!refresh && kitsEndpointKey === endpointKey && Array.isArray(cached) && cached.length) {
    names = cached.map((k) => k.name).filter(Boolean);
  } else {
    try {
      const raw = await sendGameCommand("kit list");
      names = parseKitList(raw);
      kitsEndpointKey = endpointKey;
      if (server) {
        // Always replace — including empty — so old-server kits never stick around
        server.kits = names.map((name) => ({ name, items: [] }));
      }
    } catch (error) {
      clearServerKitCache();
      kitsEndpointKey = null;
      return { ok: false, error: error.message, kits: [], endpointKey };
    }
  }

  const kits = [];
  for (const name of names) {
    const fromCache = (getServer()?.kits || []).find((k) => k.name === name);
    let items = Array.isArray(fromCache?.items)
      ? fromCache.items.map((i) => ({
          item: i.shortName || i.item,
          amount: i.quantity ?? i.amount ?? 1,
        })).filter((i) => i.item)
      : [];

    if (detail && !items.length) {
      try {
        const info = await sendGameCommand(`kit info "${name}"`);
        items = parseKitInfoItems(info);
        if (fromCache) fromCache.items = items.map((i) => ({ shortName: i.item, quantity: i.amount }));
        await sleep(80);
      } catch {
        /* info optional */
      }
    }

    kits.push({
      id: name,
      label: name,
      source: "server",
      cooldownMinutes: 0,
      items,
      updatedAt: null,
    });
  }

  const status = getRconStatus();
  return {
    ok: true,
    kits,
    endpointKey,
    host: status.host,
    port: status.port,
  };
}

export async function upsertKit({ id, label, items, cooldownMinutes } = {}) {
  const key = normalizeId(id);
  if (!key) return { ok: false, error: "Kit id required (letters, numbers, _ -)" };

  const cleanItems = sanitizeItems(items);
  if (!cleanItems.length) return { ok: false, error: "Add at least one valid item shortname" };

  const data = await getKits();
  data.kits = data.kits || {};
  data.kits[key] = {
    label: String(label ?? key).trim().slice(0, 48) || key,
    cooldownMinutes: Math.max(0, Number(cooldownMinutes) || 0),
    items: cleanItems,
    updatedAt: new Date().toISOString(),
  };
  await saveKits(data);
  return { ok: true, kit: await getKit(key) };
}

export async function deleteKit(id) {
  const key = normalizeId(id);
  const data = await getKits();
  if (!data.kits?.[key]) return { ok: false, error: "Kit not found" };
  delete data.kits[key];
  await saveKits(data);
  return { ok: true };
}

/** Give a KitManager / Oxide kit already defined on the game server. */
export async function giveServerKit(ign, kitName) {
  const name = String(ign ?? "").trim();
  const kit = String(kitName ?? "").trim();
  if (!name) return { ok: false, error: "Missing player name" };
  if (!kit) return { ok: false, error: "Missing kit name" };

  // KitManager: kit "name" "player"  |  some forks: kit give "player" "name"
  const cmd = `kit "${kit}" "${name}"`;
  try {
    const result = await sendGameCommand(cmd);
    return {
      ok: true,
      kitId: kit,
      ign: name,
      source: "server",
      command: cmd,
      given: 1,
      result: result || "",
    };
  } catch (error) {
    return { ok: false, error: error.message, kitId: kit, ign: name, command: cmd };
  }
}

/**
 * Give a panel-built kit via inventory.giveto.
 * If the kit isn't in the panel store, fall back to the in-game kit command.
 */
export async function giveKit(ign, kitId, { bypassCooldown = true, source = "auto" } = {}) {
  const name = String(ign ?? "").trim();
  if (!name) return { ok: false, error: "Missing player name" };

  void bypassCooldown;

  if (source === "server") {
    return giveServerKit(name, kitId);
  }

  const kit = await getKit(kitId);
  if (!kit) {
    if (source === "panel") {
      return { ok: false, error: `Panel kit \`${kitId}\` not found` };
    }
    // Auto: try in-game KitManager kit with the same name
    return giveServerKit(name, kitId);
  }
  if (!kit.items.length) return { ok: false, error: "Kit has no items" };

  const results = [];
  for (const row of kit.items) {
    const cmd = `inventory.giveto "${name}" "${row.item}" ${row.amount}`;
    try {
      const result = await sendGameCommand(cmd);
      results.push({ item: row.item, amount: row.amount, ok: true, result: result || "" });
    } catch (error) {
      results.push({ item: row.item, amount: row.amount, ok: false, error: error.message });
    }
    await sleep(GIVE_DELAY_MS);
  }

  const failed = results.filter((r) => !r.ok);
  return {
    ok: failed.length === 0,
    kitId: kit.id,
    ign: name,
    source: "panel",
    given: results.filter((r) => r.ok).length,
    failed: failed.length,
    results,
    error: failed.length ? `${failed.length} item(s) failed` : undefined,
  };
}

import { getKits, saveKits } from "../../data/store.js";
import { clearServerKitCache, getRconEndpointKey, getRconStatus, getServer, sendGameCommand } from "./client.js";

const GIVE_DELAY_MS = 120;

/** Last RCON host:port we successfully refreshed kits for */
let kitsEndpointKey = null;
/** Last raw `kit list` payload (for admin debugging) */
let lastKitListRaw = null;

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

  const text = raw
    .replaceAll("\\n", "\n")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .trim();

  const names = [];
  const pushName = (value) => {
    const name = String(value ?? "")
      .replace(/^["']|["']$/g, "")
      .trim();
    // Console kit names may include spaces; reject only junk / headers
    if (!name) return;
    if (/^\[KITMANAGER\]/i.test(name)) return;
    if (/^kits?\s*:?\s*$/i.test(name)) return;
    if (/^kit\s*list$/i.test(name)) return;
    if (/^available kits/i.test(name)) return;
    if (/^no kits/i.test(name)) return;
    if (name.length > 64) return;
    if (!/^[\w .'+-]+$/i.test(name)) return;
    if (!/[a-z0-9]/i.test(name)) return;
    names.push(name);
  };

  for (const line of text.split(/\r?\n/)) {
    let cleaned = line.trim();
    if (!cleaned) continue;
    if (cleaned.startsWith("[KITMANAGER]")) {
      cleaned = cleaned.replace(/^\[KITMANAGER\]\s*/i, "").trim();
      if (
        !cleaned ||
        /^kits?:/i.test(cleaned) ||
        /^kit\s*list$/i.test(cleaned) ||
        /^available/i.test(cleaned)
      ) {
        continue;
      }
    }
    cleaned = cleaned
      .replace(/^[-*•]\s*/, "")
      .replace(/^\d+[\).:\s-]+/, "")
      .trim();
    if (/^kit\s*list$/i.test(cleaned)) continue;
    pushName(cleaned);
  }

  return [...new Set(names)];
}

function parseKitInfoItems(raw) {
  if (!raw || typeof raw !== "string") return [];
  const cleaned = raw.replaceAll("\\n", "\n");
  const items = [];

  // Console KitManager lines often look like:
  // ID: [3] Shortname: wood Amount: [1000] Condition: [1] Container: [Main]
  const itemRegex =
    /(?:ID:\s*\[?(\d+)\]?\s*)?Shortname:\s*(\S+)\s+Amount:\s*\[(\d+)\](?:\s+Condition:\s*\[([\d.]+)\])?(?:\s+Container:\s*\[(Main|Belt|Wear)\])?/gi;
  let match;
  while ((match = itemRegex.exec(cleaned)) !== null) {
    items.push({
      id: match[1] != null ? match[1] : null,
      item: match[2],
      amount: Number(match[3]) || 1,
      condition: match[4] != null ? Number(match[4]) : null,
      container: match[5] || null,
    });
  }

  if (!items.length) {
    for (const line of cleaned.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const m = line.match(/^([a-z0-9._-]+)\s*[x×]\s*(\d+)$/i) || line.match(/^([a-z0-9._-]+)\s+(\d+)$/i);
      if (m) items.push({ id: null, item: m[1].toLowerCase(), amount: Number(m[2]) || 1, condition: null, container: null });
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
export async function listServerKits({ refresh = true, detail = false, force = false } = {}) {
  const endpointKey = getRconEndpointKey();
  const server = getServer();

  if (force || (kitsEndpointKey && endpointKey && kitsEndpointKey !== endpointKey)) {
    clearServerKitCache();
    kitsEndpointKey = null;
    lastKitListRaw = null;
  }

  let names = [];
  let rawPreview = lastKitListRaw;

  if (!refresh && !force && kitsEndpointKey === endpointKey && Array.isArray(server?.kits)) {
    names = server.kits.map((k) => k.name).filter(Boolean);
  } else {
    try {
      clearServerKitCache();
      kitsEndpointKey = null;
      const raw = await sendGameCommand("kit list");
      lastKitListRaw = String(raw || "");
      rawPreview = lastKitListRaw.slice(0, 800);
      names = parseKitList(raw);
      kitsEndpointKey = endpointKey;
      if (server) {
        server.kits = names.map((name) => ({ name, items: [] }));
      }
    } catch (error) {
      clearServerKitCache();
      kitsEndpointKey = null;
      lastKitListRaw = null;
      return {
        ok: false,
        error: error.message,
        kits: [],
        endpointKey,
        rawPreview: null,
      };
    }
  }

  const kits = [];
  for (const name of names) {
    const fromCache = (getServer()?.kits || []).find((k) => k.name === name);
    let items = Array.isArray(fromCache?.items)
      ? fromCache.items
          .map((i) => ({
            id: i.id ?? null,
            item: i.shortName || i.item,
            amount: i.quantity ?? i.amount ?? 1,
            condition: i.condition ?? null,
            container: i.container || null,
          }))
          .filter((i) => i.item)
      : [];

    if (detail && !items.length) {
      try {
        const info = await sendGameCommand(`kit info "${name}"`);
        items = parseKitInfoItems(info);
        if (fromCache) {
          fromCache.items = items.map((i) => ({
            id: i.id,
            shortName: i.item,
            quantity: i.amount,
            condition: i.condition,
            container: i.container,
          }));
        }
        await sleep(100);
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
    rawPreview: rawPreview != null ? String(rawPreview).slice(0, 800) : null,
  };
}

/** Hard clear + re-fetch kit list from the current RCON server. */
export async function resyncServerKits({ detail = false } = {}) {
  clearServerKitCache();
  kitsEndpointKey = null;
  lastKitListRaw = null;
  return listServerKits({ refresh: true, force: true, detail });
}

/** Load item contents for one in-game kit via `kit info`. */
export async function getServerKitDetails(kitName) {
  const kit = String(kitName ?? "").trim();
  if (!kit) return { ok: false, error: "Missing kit name", items: [] };

  try {
    const raw = await sendGameCommand(`kit info "${kit}"`);
    const items = parseKitInfoItems(raw);
    const server = getServer();
    if (server) {
      if (!Array.isArray(server.kits)) server.kits = [];
      let row = server.kits.find((k) => k.name === kit);
      if (!row) {
        row = { name: kit, items: [] };
        server.kits.push(row);
      }
      row.items = items.map((i) => ({
        id: i.id,
        shortName: i.item,
        quantity: i.amount,
        condition: i.condition,
        container: i.container,
      }));
    }
    return {
      ok: true,
      kit,
      items,
      rawPreview: String(raw || "").slice(0, 1200),
    };
  } catch (error) {
    return { ok: false, error: error.message, kit, items: [] };
  }
}

/**
 * Add an item to an in-game kit:
 * kit add "Kit Name" shortname amount condition Container
 */
export async function addServerKitItem(kitName, { item, amount = 1, condition = 1, container = "Main" } = {}) {
  const kit = String(kitName ?? "").trim();
  const shortName = String(item ?? "").trim().toLowerCase();
  const qty = Math.max(1, Math.min(100000, Number(amount) || 1));
  const cond = Math.max(0, Math.min(1, Number(condition) || 1));
  const slot = ["Main", "Belt", "Wear"].includes(container) ? container : "Main";

  if (!kit) return { ok: false, error: "Missing kit name" };
  if (!shortName || !/^[a-z0-9._-]+$/.test(shortName)) {
    return { ok: false, error: "Invalid item shortname" };
  }

  try {
    const cmd = `kit add "${kit}" ${shortName} ${qty} ${cond} ${slot}`;
    const result = await sendGameCommand(cmd);
    const details = await getServerKitDetails(kit);
    return {
      ok: true,
      command: cmd,
      result: result || "",
      kit,
      items: details.items || [],
      rawPreview: details.rawPreview || null,
    };
  } catch (error) {
    return { ok: false, error: error.message, kit };
  }
}

/** Remove one item from an in-game kit: kit remove "Kit Name" "ID" */
export async function removeServerKitItem(kitName, itemId) {
  const kit = String(kitName ?? "").trim();
  const id = String(itemId ?? "").trim();
  if (!kit) return { ok: false, error: "Missing kit name" };
  if (!id) return { ok: false, error: "Missing item id (from kit info)" };

  try {
    const cmd = `kit remove "${kit}" "${id}"`;
    const result = await sendGameCommand(cmd);
    const details = await getServerKitDetails(kit);
    return {
      ok: true,
      command: cmd,
      result: result || "",
      kit,
      items: details.items || [],
      rawPreview: details.rawPreview || null,
    };
  } catch (error) {
    return { ok: false, error: error.message, kit };
  }
}

/** Delete a KitManager kit on the live game server, then resync. */
export async function deleteServerKit(kitName) {
  const kit = String(kitName ?? "").trim();
  if (!kit) return { ok: false, error: "Missing kit name", kits: [] };

  try {
    const result = await sendGameCommand(`kit delete "${kit}"`);
    const synced = await resyncServerKits({ detail: false });
    return {
      ...synced,
      ok: synced.ok !== false,
      deleted: kit,
      deleteResult: result || "",
    };
  } catch (error) {
    return { ok: false, error: error.message, deleted: kit, kits: [] };
  }
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

  // Console KitManager: kit givetoplayer "kitname" "player"
  const cmd = `kit givetoplayer "${kit}" "${name}"`;
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

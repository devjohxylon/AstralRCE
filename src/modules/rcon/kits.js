import { getKits, saveKits } from "../../data/store.js";
import { sendGameCommand } from "./client.js";

const GIVE_DELAY_MS = 120;

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

export async function listKits() {
  const data = await getKits();
  return Object.entries(data.kits || {}).map(([id, kit]) => ({
    id,
    label: kit.label || id,
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
    cooldownMinutes: Number(kit.cooldownMinutes) || 0,
    items: Array.isArray(kit.items) ? kit.items : [],
    updatedAt: kit.updatedAt || null,
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

/** Give every item in a kit to an online player via inventory.giveto */
export async function giveKit(ign, kitId, { bypassCooldown = true } = {}) {
  const name = String(ign ?? "").trim();
  if (!name) return { ok: false, error: "Missing player name" };

  const kit = await getKit(kitId);
  if (!kit) return { ok: false, error: `Kit \`${kitId}\` not found` };
  if (!kit.items.length) return { ok: false, error: "Kit has no items" };

  void bypassCooldown; // reserved for player self-redeem later

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
    given: results.filter((r) => r.ok).length,
    failed: failed.length,
    results,
    error: failed.length ? `${failed.length} item(s) failed` : undefined,
  };
}

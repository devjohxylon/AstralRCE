import { config } from "../../config.js";
import { getEconomy, saveEconomy } from "../../data/store.js";
import { sendGameCommand } from "./client.js";
import { findOnlinePlayer, requireLinkedIgn } from "./linking.js";

let cache = null;
let dirty = false;
const playtimeTicks = new Map();

async function load() {
  if (!cache) {
    cache = await getEconomy();
    if (!Array.isArray(cache.shop)) cache.shop = [];
    if (!cache.balances) cache.balances = {};
  }
  return cache;
}

async function persist() {
  if (!dirty) return;
  await saveEconomy(cache);
  dirty = false;
}

function ensureBalance(data, discordId) {
  if (data.balances[discordId] == null) {
    data.balances[discordId] = config.economy.startingBalance;
    dirty = true;
  }
  return data.balances[discordId];
}

export async function getBalance(discordId) {
  const data = await load();
  return ensureBalance(data, discordId);
}

export async function addBalance(discordId, amount, reason = "") {
  if (!config.economy.enabled || !amount) return null;
  const data = await load();
  const next = ensureBalance(data, discordId) + amount;
  data.balances[discordId] = Math.max(0, Math.floor(next));
  dirty = true;
  await persist();
  return { balance: data.balances[discordId], reason };
}

export async function rewardKill(discordId) {
  return addBalance(discordId, config.economy.killReward, "kill");
}

export async function penalizeDeath(discordId) {
  return addBalance(discordId, -config.economy.deathPenalty, "death");
}

export async function tickPlaytime(discordId) {
  if (!config.economy.enabled) return null;
  const mins = config.economy.playtimeMinutes;
  const current = (playtimeTicks.get(discordId) ?? 0) + 1;
  playtimeTicks.set(discordId, current);

  if (current % mins === 0) {
    return addBalance(discordId, config.economy.playtimeReward, "playtime");
  }
  return null;
}

export async function listShop() {
  const data = await load();
  return data.shop;
}

export async function addShopItem({ id, label, price, item, amount = 1, kit = null }) {
  const data = await load();
  const cleanId = String(id)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 24);
  if (!cleanId) return { ok: false, error: "Invalid shop id." };
  if (data.shop.some((s) => s.id === cleanId)) {
    return { ok: false, error: `Shop item \`${cleanId}\` already exists.` };
  }

  const entry = {
    id: cleanId,
    label: label || cleanId,
    price: Math.max(1, Number(price) || 1),
    item: item || null,
    amount: Math.max(1, Number(amount) || 1),
    kit: kit || null,
  };
  data.shop.push(entry);
  dirty = true;
  await persist();
  return { ok: true, item: entry };
}

export async function removeShopItem(id) {
  const data = await load();
  const before = data.shop.length;
  data.shop = data.shop.filter((s) => s.id !== id);
  if (data.shop.length === before) return { ok: false, error: "Item not found." };
  dirty = true;
  await persist();
  return { ok: true };
}

export async function buyItem(discordId, shopId) {
  if (!config.economy.enabled) {
    return { ok: false, error: "Economy is disabled." };
  }

  const linked = await requireLinkedIgn(discordId);
  if (!linked.ok) return linked;

  if (!findOnlinePlayer(linked.ign)) {
    return { ok: false, error: `\`${linked.ign}\` must be online to receive the item.` };
  }

  const data = await load();
  const entry = data.shop.find((s) => s.id === shopId);
  if (!entry) return { ok: false, error: "Unknown shop item. Use `/shop` to browse." };

  const balance = ensureBalance(data, discordId);
  if (balance < entry.price) {
    return {
      ok: false,
      error: `Not enough coins. Need **${entry.price}**, you have **${balance}**.`,
    };
  }

  data.balances[discordId] = balance - entry.price;
  dirty = true;
  await persist();

  try {
    if (entry.kit) {
      await sendGameCommand(`kit "${entry.kit}" "${linked.ign}"`);
    } else if (entry.item) {
      await sendGameCommand(
        `inventory.giveto "${linked.ign}" "${entry.item}" ${entry.amount}`,
      );
    } else {
      throw new Error("Shop item has no kit or item configured.");
    }
  } catch (error) {
    data.balances[discordId] = balance;
    dirty = true;
    await persist();
    return { ok: false, error: `Purchase failed, coins refunded: ${error.message}` };
  }

  await sendGameCommand(
    `say <color=#f1c40f>${linked.ign}</color> bought <color=#f1c40f>${entry.label}</color>`,
  ).catch(() => {});

  return {
    ok: true,
    item: entry,
    balance: data.balances[discordId],
    ign: linked.ign,
  };
}

export async function flushEconomy() {
  await persist();
}

// Seed a sensible default shop the first time the file is empty.
export async function ensureDefaultShop() {
  const data = await load();
  if (data.shop.length) return;
  data.shop = [
    { id: "wood", label: "Wood x1000", price: 50, item: "wood", amount: 1000, kit: null },
    { id: "stone", label: "Stone x1000", price: 50, item: "stones", amount: 1000, kit: null },
    {
      id: "metal",
      label: "Metal Frags x500",
      price: 100,
      item: "metal.fragments",
      amount: 500,
      kit: null,
    },
    { id: "scrap", label: "Scrap x100", price: 150, item: "scrap", amount: 100, kit: null },
  ];
  dirty = true;
  await persist();
}

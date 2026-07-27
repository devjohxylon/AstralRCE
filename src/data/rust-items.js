import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { consoleKitExtras, isConsoleKitItem } from "./console-items.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(
  readFileSync(path.join(__dirname, "rust-items.json"), "utf8"),
);

const RAW = Array.isArray(CATALOG.items) ? CATALOG.items : [];
const byId = new Map();
for (const item of RAW.filter(isConsoleKitItem)) {
  byId.set(item.id, item);
}
for (const item of consoleKitExtras()) {
  if (!byId.has(item.id)) byId.set(item.id, item);
}
const ITEMS = [...byId.values()].sort((a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
);
const CATEGORIES = [...new Set(ITEMS.map((i) => i.category).filter(Boolean))].sort();

export function listRustItems({ q = "", category = "" } = {}) {
  const query = String(q ?? "").trim().toLowerCase();
  const cat = String(category ?? "").trim();

  let rows = ITEMS;
  if (cat && cat !== "All") {
    rows = rows.filter((i) => i.category === cat);
  }
  if (query) {
    rows = rows.filter(
      (i) =>
        i.id.includes(query) ||
        i.name.toLowerCase().includes(query) ||
        i.category.toLowerCase().includes(query),
    );
  }

  return {
    platform: "console",
    label: "Rust Console Edition",
    total: ITEMS.length,
    categories: ["All", ...CATEGORIES],
    items: rows,
  };
}

export function getRustItem(shortname) {
  const id = String(shortname ?? "").trim().toLowerCase();
  return ITEMS.find((i) => i.id === id) || null;
}

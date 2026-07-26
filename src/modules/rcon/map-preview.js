import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "../../data/store.js";

const MAPS_DIR = path.join(DATA_DIR, "maps");
const API = "https://api.rustmaps.com/v4/maps";

function apiKey() {
  return process.env.RUSTMAPS_API_KEY?.trim() || process.env.RUST_MAPS_API_KEY?.trim() || "";
}

function cachePath(seed, size) {
  return path.join(MAPS_DIR, `${seed}_${size}.jpg`);
}

function metaPath(seed, size) {
  return path.join(MAPS_DIR, `${seed}_${size}.json`);
}

async function ensureMapsDir() {
  await fs.mkdir(MAPS_DIR, { recursive: true });
}

export async function hasCachedMapImage(seed, size) {
  if (!seed || !size) return false;
  try {
    await fs.access(cachePath(seed, size));
    return true;
  } catch {
    return false;
  }
}

export async function readCachedMapImage(seed, size) {
  if (!(await hasCachedMapImage(seed, size))) return null;
  return fs.readFile(cachePath(seed, size));
}

async function downloadToCache(url, seed, size) {
  const res = await fetch(url, {
    headers: { "User-Agent": "AstralBot/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  const type = res.headers.get("content-type") || "";
  if (!type.includes("image") && !type.includes("octet-stream")) {
    throw new Error(`Not an image (${type || "unknown type"})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await ensureMapsDir();
  await fs.writeFile(cachePath(seed, size), buf);
  await fs.writeFile(
    metaPath(seed, size),
    JSON.stringify({ seed, size, source: url, cachedAt: new Date().toISOString() }, null, 2),
  );
  return buf;
}

async function rustmapsGet(seed, size) {
  const key = apiKey();
  if (!key) return null;
  const url = `${API}/${size}/${seed}?staging=false`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "x-api-key": key },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return { status: "missing" };
  if (res.status === 409) return { status: "generating" };
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RustMaps GET ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  const data = body?.data || body;
  return {
    status: "ready",
    imageUrl: data.imageUrl || data.rawImageUrl || data.thumbnailUrl || null,
    id: data.id || null,
  };
}

async function rustmapsGenerate(seed, size) {
  const key = apiKey();
  if (!key) return null;
  const res = await fetch(API, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify({ size: Number(size), seed: Number(seed), staging: false }),
    signal: AbortSignal.timeout(20_000),
  });
  // 200 = already exists, 201 = started, 409 = generating
  if (res.status === 200 || res.status === 201 || res.status === 409) {
    return { status: res.status === 409 ? "generating" : "ok" };
  }
  const text = await res.text().catch(() => "");
  throw new Error(`RustMaps generate ${res.status}: ${text.slice(0, 200)}`);
}

/**
 * Resolve a map preview image into local cache.
 * Priority: existing cache → RUST_MAP_IMAGE_URL → RustMaps API (if key set).
 */
export async function ensureMapPreview(seed, size, { force = false } = {}) {
  const s = Number(seed);
  const z = Number(size) || 4000;
  if (!Number.isFinite(s) || s <= 0) {
    return { ok: false, status: "no_seed", imageReady: false };
  }

  if (!force && (await hasCachedMapImage(s, z))) {
    return {
      ok: true,
      status: "cached",
      imageReady: true,
      proxyPath: `/admin/api/map/image?seed=${s}&size=${z}`,
    };
  }

  const custom = process.env.RUST_MAP_IMAGE_URL?.trim();
  if (custom) {
    try {
      await downloadToCache(custom, s, z);
      return {
        ok: true,
        status: "custom",
        imageReady: true,
        proxyPath: `/admin/api/map/image?seed=${s}&size=${z}`,
      };
    } catch (error) {
      console.error("Custom map image failed:", error.message);
    }
  }

  if (!apiKey()) {
    return {
      ok: false,
      status: "needs_key",
      imageReady: false,
      message:
        "Add RUSTMAPS_API_KEY (free at rustmaps.com/dashboard) or RUST_MAP_IMAGE_URL for a real map preview.",
      rustmapsUrl: `https://rustmaps.com/map/${s}_${z}`,
    };
  }

  try {
    let info = await rustmapsGet(s, z);
    if (info?.status === "missing" || (info?.status === "ready" && !info.imageUrl)) {
      await rustmapsGenerate(s, z);
      // brief wait then re-fetch
      await new Promise((r) => setTimeout(r, 1500));
      info = await rustmapsGet(s, z);
    }

    if (info?.status === "generating") {
      return {
        ok: true,
        status: "generating",
        imageReady: false,
        message: "RustMaps is generating this map — click Refresh Map in a minute.",
        rustmapsUrl: `https://rustmaps.com/map/${s}_${z}`,
      };
    }

    if (info?.status === "ready" && info.imageUrl) {
      await downloadToCache(info.imageUrl, s, z);
      return {
        ok: true,
        status: "ready",
        imageReady: true,
        proxyPath: `/admin/api/map/image?seed=${s}&size=${z}`,
        rustmapsUrl: `https://rustmaps.com/map/${s}_${z}`,
      };
    }

    return {
      ok: false,
      status: "unavailable",
      imageReady: false,
      message: "Map preview not available yet from RustMaps.",
      rustmapsUrl: `https://rustmaps.com/map/${s}_${z}`,
    };
  } catch (error) {
    console.error("RustMaps preview failed:", error.message);
    return {
      ok: false,
      status: "error",
      imageReady: false,
      message: error.message,
      rustmapsUrl: `https://rustmaps.com/map/${s}_${z}`,
    };
  }
}

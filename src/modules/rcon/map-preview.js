import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "../../data/store.js";

const MAPS_DIR = path.join(DATA_DIR, "maps");
const CURRENT_IMAGE = path.join(MAPS_DIR, "current.jpg");
const CURRENT_META = path.join(MAPS_DIR, "current.json");
const API = "https://api.rustmaps.com/v4/maps";

function apiKey() {
  return process.env.RUSTMAPS_API_KEY?.trim() || process.env.RUST_MAPS_API_KEY?.trim() || "";
}

function rustmapsEnabled() {
  // Off by default — PC RustMaps does not match Rust Console Edition maps
  const flag = process.env.RUSTMAPS_ENABLE?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function cachePath(seed, size) {
  return path.join(MAPS_DIR, `${seed}_${size}.jpg`);
}

async function ensureMapsDir() {
  await fs.mkdir(MAPS_DIR, { recursive: true });
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function hasCachedMapImage(_seed, _size) {
  return fileExists(CURRENT_IMAGE);
}

export async function readCachedMapImage(_seed, _size) {
  if (await fileExists(CURRENT_IMAGE)) {
    return fs.readFile(CURRENT_IMAGE);
  }
  return null;
}

export async function getMapImageMeta() {
  try {
    const raw = await fs.readFile(CURRENT_META, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeImageFiles(buf, seed, size, meta = {}) {
  await ensureMapsDir();
  await fs.writeFile(CURRENT_IMAGE, buf);
  if (seed && size) {
    await fs.writeFile(cachePath(seed, size), buf);
  }
  await fs.writeFile(
    CURRENT_META,
    JSON.stringify(
      {
        seed: seed || null,
        size: size || null,
        cachedAt: new Date().toISOString(),
        ...meta,
      },
      null,
      2,
    ),
  );
}

export async function saveUploadedMapImage(buffer, { seed = null, size = null, filename = null } = {}) {
  if (!buffer?.length) throw new Error("Empty image");
  if (buffer.length > 8 * 1024 * 1024) throw new Error("Image too large (max 8MB)");

  // Basic magic-byte check
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
  const isWebp = buffer.toString("ascii", 0, 4) === "RIFF";
  if (!isJpeg && !isPng && !isWebp) {
    throw new Error("Upload a JPG, PNG, or WebP image of your in-game map");
  }

  await writeImageFiles(Buffer.from(buffer), seed, size, {
    source: "upload",
    filename: filename || null,
  });

  return {
    ok: true,
    status: "uploaded",
    imageReady: true,
    proxyPath: `/admin/api/map/image?seed=${seed || 0}&size=${size || 0}`,
  };
}

export async function clearMapImage(seed, size) {
  await ensureMapsDir();
  for (const p of [CURRENT_IMAGE, CURRENT_META, seed && size ? cachePath(seed, size) : null]) {
    if (!p) continue;
    try {
      await fs.unlink(p);
    } catch {
      /* missing ok */
    }
  }
  return { ok: true };
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
  await writeImageFiles(buf, seed, size, { source: url });
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
  if (res.status === 200 || res.status === 201 || res.status === 409) {
    return { status: res.status === 409 ? "generating" : "ok" };
  }
  const text = await res.text().catch(() => "");
  throw new Error(`RustMaps generate ${res.status}: ${text.slice(0, 200)}`);
}

/**
 * Resolve a map preview image into local cache.
 * Priority: uploaded/current → RUST_MAP_IMAGE_URL → RustMaps (only if RUSTMAPS_ENABLE=true).
 * Console maps never match PC RustMaps, so upload is the correct path for RCE.
 */
export async function ensureMapPreview(seed, size, { force = false } = {}) {
  const s = Number(seed) || null;
  const z = Number(size) || 4000;

  if (!force && (await hasCachedMapImage(s, z))) {
    const meta = await getMapImageMeta();
    return {
      ok: true,
      status: meta?.source === "upload" ? "uploaded" : "cached",
      imageReady: true,
      proxyPath: `/admin/api/map/image?seed=${s || 0}&size=${z}`,
      source: meta?.source || "cache",
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
        proxyPath: `/admin/api/map/image?seed=${s || 0}&size=${z}`,
        source: "url",
      };
    } catch (error) {
      console.error("Custom map image failed:", error.message);
    }
  }

  if (!rustmapsEnabled() || !apiKey() || !s) {
    return {
      ok: false,
      status: "needs_upload",
      imageReady: false,
      message:
        "Console maps don't match PC RustMaps. Upload an in-game map screenshot (or Nitrado preset image) for an accurate Live Map.",
    };
  }

  try {
    let info = await rustmapsGet(s, z);
    if (info?.status === "missing" || (info?.status === "ready" && !info.imageUrl)) {
      await rustmapsGenerate(s, z);
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
        source: "rustmaps",
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

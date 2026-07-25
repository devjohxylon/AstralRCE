import crypto from "crypto";
import { config } from "../../config.js";
import {
  getAccessKeys,
  saveAccessKeys,
  getPanelLogs,
  savePanelLogs,
} from "../../data/store.js";

/** Permissions staff keys may be granted. Never includes keys/logs. */
export const STAFF_PERMISSIONS = {
  overview: true,
  players: true,
  kick: true,
  ban: false,
  teleport: true,
  broadcast: true,
  rcon: false,
  stats: true,
  statsReset: false,
  warps: true,
  links: true,
  automessages: true,
  schedule: false,
  kits: false,
};

export const OWNER_PERMISSIONS = {
  ...Object.fromEntries(Object.keys(STAFF_PERMISSIONS).map((k) => [k, true])),
  keys: true,
  logs: true,
  kits: true,
};

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = "astral_admin";

function signingSecret() {
  return config.adminPanel.password || "astral-admin";
}

function hashKey(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", signingSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.get("cookie") ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return i === -1 ? [p, ""] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      }),
  );
}

export function getSession(req) {
  const cookies = parseCookies(req);
  const payload = verify(cookies[COOKIE]);
  if (!payload) return null;
  if (payload.role === "owner") {
    return {
      role: "owner",
      label: "Owner",
      keyId: null,
      permissions: { ...OWNER_PERMISSIONS },
    };
  }
  if (payload.role === "staff" && payload.keyId) {
    return {
      role: "staff",
      label: payload.label || "Staff",
      keyId: payload.keyId,
      permissions: sanitizeStaffPerms(payload.permissions),
    };
  }
  return null;
}

function sanitizeStaffPerms(input = {}) {
  const out = { ...STAFF_PERMISSIONS };
  for (const key of Object.keys(STAFF_PERMISSIONS)) {
    if (typeof input[key] === "boolean") out[key] = input[key];
  }
  // Hard lock — staff keys can never manage keys or view audit logs
  out.keys = false;
  out.logs = false;
  return out;
}

export function setSessionCookie(res, sessionPayload) {
  const token = sign({
    ...sessionPayload,
    exp: Date.now() + SESSION_TTL_MS,
  });
  const secure = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production"
    ? "; Secure"
    : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`,
  );
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
}

export async function authenticateAccessKey(raw) {
  const password = String(raw ?? "");
  if (!password) return null;

  // Owner master key from env
  if (password === config.adminPanel.password) {
    return {
      role: "owner",
      label: "Owner",
      keyId: null,
      permissions: { ...OWNER_PERMISSIONS },
    };
  }

  const data = await getAccessKeys();
  const digest = hashKey(password);
  const found = data.keys.find((k) => k.hash === digest && k.enabled !== false);
  if (!found) return null;

  found.lastUsedAt = new Date().toISOString();
  await saveAccessKeys(data);

  return {
    role: "staff",
    label: found.label,
    keyId: found.id,
    permissions: sanitizeStaffPerms(found.permissions),
  };
}

function publicKey(row) {
  return {
    id: row.id,
    label: row.label,
    enabled: row.enabled !== false,
    permissions: sanitizeStaffPerms(row.permissions),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
  };
}

export async function listAccessKeys() {
  const data = await getAccessKeys();
  return data.keys.map(publicKey);
}

export async function createAccessKey({ label, permissions } = {}) {
  const name = String(label ?? "").trim().slice(0, 48) || "Staff";
  const raw = `ask_${crypto.randomBytes(18).toString("base64url")}`;
  const row = {
    id: crypto.randomBytes(8).toString("hex"),
    label: name,
    hash: hashKey(raw),
    enabled: true,
    permissions: sanitizeStaffPerms(permissions),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  const data = await getAccessKeys();
  data.keys.unshift(row);
  await saveAccessKeys(data);
  return { key: publicKey(row), secret: raw };
}

export async function updateAccessKey(id, patch = {}) {
  const data = await getAccessKeys();
  const row = data.keys.find((k) => k.id === id);
  if (!row) return null;
  if (typeof patch.label === "string" && patch.label.trim()) {
    row.label = patch.label.trim().slice(0, 48);
  }
  if (typeof patch.enabled === "boolean") row.enabled = patch.enabled;
  if (patch.permissions && typeof patch.permissions === "object") {
    row.permissions = sanitizeStaffPerms({ ...row.permissions, ...patch.permissions });
  }
  await saveAccessKeys(data);
  return publicKey(row);
}

export async function revokeAccessKey(id) {
  const data = await getAccessKeys();
  const before = data.keys.length;
  data.keys = data.keys.filter((k) => k.id !== id);
  if (data.keys.length === before) return false;
  await saveAccessKeys(data);
  return true;
}

export async function appendPanelLog(entry) {
  const data = await getPanelLogs();
  data.entries.unshift({
    id: crypto.randomBytes(6).toString("hex"),
    at: new Date().toISOString(),
    ...entry,
  });
  data.entries = data.entries.slice(0, 1000);
  await savePanelLogs(data);
}

export async function listPanelLogs(limit = 100) {
  const data = await getPanelLogs();
  return data.entries.slice(0, Math.min(Number(limit) || 100, 500));
}

export function hasPerm(session, perm) {
  if (!session) return false;
  if (session.role === "owner") return true;
  return Boolean(session.permissions?.[perm]);
}

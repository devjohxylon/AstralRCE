import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR } from "../../data/store.js";

const FILE = "vip-claims.json";

function emptyState(wipeId = null, wipeStartedAt = null) {
  return {
    wipeId: wipeId || null,
    wipeStartedAt: wipeStartedAt || null,
    claims: {},
  };
}

async function readState() {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, FILE), "utf8");
    const data = JSON.parse(raw);
    return {
      wipeId: data.wipeId || null,
      wipeStartedAt: data.wipeStartedAt || null,
      claims: data.claims && typeof data.claims === "object" ? data.claims : {},
    };
  } catch {
    return emptyState();
  }
}

async function writeState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    path.join(DATA_DIR, FILE),
    JSON.stringify(state, null, 2),
    "utf8",
  );
  return state;
}

export async function getVipClaimState() {
  return readState();
}

/** Start a new wipe window — clears claims and starts the post-wipe lockout clock. */
export async function startVipWipeWindow(wipeLabel = null) {
  const wipeId = String(wipeLabel || new Date().toISOString().slice(0, 10)).trim();
  const wipeStartedAt = new Date().toISOString();
  return writeState(emptyState(wipeId, wipeStartedAt));
}

export async function findVipClaim({ ign, discordId } = {}) {
  const state = await readState();
  const key = String(ign || "").trim().toLowerCase();
  if (key && state.claims[key]) {
    return { ...state.claims[key], by: "ign", wipeId: state.wipeId };
  }
  if (discordId) {
    const hit = Object.entries(state.claims).find(
      ([, c]) => c?.discordId && String(c.discordId) === String(discordId),
    );
    if (hit) {
      return { ...hit[1], by: "discord", ign: hit[0], wipeId: state.wipeId };
    }
  }
  return null;
}

export async function recordVipClaim({ ign, discordId, kitId } = {}) {
  const state = await readState();
  // Track wipe id for bookkeeping only — do NOT set wipeStartedAt here.
  // wipeStartedAt starts the post-wipe lock and must only come from wipe automation.
  if (!state.wipeId) {
    state.wipeId = new Date().toISOString().slice(0, 10);
  }
  const key = String(ign || "").trim().toLowerCase();
  if (!key) throw new Error("Missing IGN");
  state.claims[key] = {
    at: new Date().toISOString(),
    discordId: discordId ? String(discordId) : null,
    kitId: kitId || null,
  };
  await writeState(state);
  return state.claims[key];
}

/**
 * Seconds remaining in the post-wipe lockout, or 0 if claims are open.
 * @param {number} lockHours
 */
export async function vipPostWipeLockRemainingSeconds(lockHours = 4) {
  const hours = Number(lockHours);
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  const state = await readState();
  if (!state.wipeStartedAt) return 0;
  const start = new Date(state.wipeStartedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  const unlockAt = start + hours * 3600 * 1000;
  return Math.max(0, Math.ceil((unlockAt - Date.now()) / 1000));
}

/** Clear the post-wipe lockout — allows VIP claims immediately. */
export async function clearVipPostWipeLock() {
  const state = await readState();
  if (!state.wipeId && !state.wipeStartedAt && Object.keys(state.claims).length === 0) {
    return { ok: false, error: "No wipe window active" };
  }
  state.wipeStartedAt = null;
  await writeState(state);
  return { ok: true, wipeId: state.wipeId, clearedAt: new Date().toISOString() };
}

/** Get current VIP claim status with lock info. */
export async function getVipClaimStatus(lockHours = 4) {
  const state = await readState();
  const lockRemaining = await vipPostWipeLockRemainingSeconds(lockHours);
  return {
    wipeId: state.wipeId,
    wipeStartedAt: state.wipeStartedAt,
    totalClaims: Object.keys(state.claims).length,
    lockActive: lockRemaining > 0,
    lockRemainingSeconds: lockRemaining,
  };
}

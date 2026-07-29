/** Shared Rust RCON position parsing (printpos / teleportpos). */

/**
 * Parse an (x, y, z) triple from RCON output.
 * Prefers parentheses; falls back to the last comma-triple in the string.
 * Rejects absurd values so we don't paint dots from error/garbage text.
 */
export function parsePosition(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  let match = text.match(
    /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/,
  );
  if (!match) {
    const all = [
      ...text.matchAll(
        /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g,
      ),
    ];
    match = all.length ? all[all.length - 1] : null;
  }
  if (!match) return null;

  const x = Number(match[1]);
  const y = Number(match[2]);
  const z = Number(match[3]);
  if (![x, y, z].every(Number.isFinite)) return null;

  // Ground height is usually small; world X/Z stay within a few km of origin.
  if (Math.abs(x) > 20_000 || Math.abs(z) > 20_000 || Math.abs(y) > 5_000) {
    return null;
  }

  return { x, y, z };
}

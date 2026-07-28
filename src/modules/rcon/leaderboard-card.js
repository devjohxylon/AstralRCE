import { createCanvas } from "@napi-rs/canvas";
import {
  formatPlaytime,
  getLeaderboard,
  statsSummary,
} from "./stats.js";

const W = 980;
const H = 720;
const PAD = 28;

const COLORS = {
  bg0: "#07090e",
  bg1: "#0e131c",
  panel: "rgba(18, 22, 32, 0.92)",
  panelEdge: "rgba(255,255,255,0.06)",
  text: "#f2f4f8",
  muted: "rgba(180, 190, 210, 0.55)",
  faint: "rgba(160, 170, 190, 0.28)",
  gold: "#f0b429",
  killers: "#ff4d9a",
  killersDim: "rgba(255, 77, 154, 0.14)",
  kd: "#4db8ff",
  kdDim: "rgba(77, 184, 255, 0.14)",
  play: "#b794f6",
  playDim: "rgba(183, 148, 246, 0.14)",
};

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, fill) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, w, h, r, stroke, width = 1) {
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function truncate(ctx, text, maxWidth) {
  const s = String(text ?? "");
  if (ctx.measureText(s).width <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function drawBackground(ctx) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, COLORS.bg0);
  g.addColorStop(0.45, COLORS.bg1);
  g.addColorStop(1, "#12101a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Soft accent orbs
  const orb = (x, y, r, color) => {
    const rad = ctx.createRadialGradient(x, y, 0, x, y, r);
    rad.addColorStop(0, color);
    rad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, W, H);
  };
  orb(120, 80, 280, "rgba(255, 77, 154, 0.16)");
  orb(820, 180, 260, "rgba(77, 184, 255, 0.12)");
  orb(760, 560, 240, "rgba(183, 148, 246, 0.12)");

  // Fine grid
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.025)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPanel(ctx, x, y, w, h, accent) {
  fillRoundRect(ctx, x, y, w, h, 16, COLORS.panel);
  strokeRoundRect(ctx, x, y, w, h, 16, COLORS.panelEdge, 1.5);

  // Left accent bar
  ctx.save();
  roundRect(ctx, x, y, 5, h, 16);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 5, h);
  ctx.restore();

  // Soft top highlight
  const shine = ctx.createLinearGradient(x, y, x, y + 48);
  shine.addColorStop(0, "rgba(255,255,255,0.05)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  fillRoundRect(ctx, x, y, w, 48, 16, shine);
}

function drawHeader(ctx, wipeLabel) {
  ctx.fillStyle = COLORS.muted;
  ctx.font = "600 12px sans-serif";
  ctx.fillText("ASTRAL VANILLA+", PAD, 28);

  ctx.fillStyle = COLORS.text;
  ctx.font = "700 28px sans-serif";
  ctx.fillText("Wipe Leaderboard", PAD, 58);

  if (wipeLabel) {
    ctx.fillStyle = COLORS.faint;
    ctx.font = "500 12px monospace";
    ctx.fillText(`wipe · ${wipeLabel}`, PAD, 78);
  }
}

function drawRows(ctx, { x, y, rowH, rows, cols, accent, empty }) {
  if (!rows.length) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = "500 13px sans-serif";
    ctx.fillText(empty || "No data yet", x + 22, y + 28);
    return;
  }

  const panelInnerW = cols[2].x + cols[2].w - x - 14;

  rows.forEach((row, i) => {
    const ry = y + i * rowH;
    if (i % 2 === 1) {
      fillRoundRect(ctx, x + 10, ry - 14, panelInnerW, rowH - 2, 8, "rgba(255,255,255,0.02)");
    }

    const rankColor = row.rank <= 3 ? COLORS.gold : COLORS.muted;
    ctx.fillStyle = rankColor;
    ctx.font = "700 13px monospace";
    ctx.fillText(String(row.rank), cols[0].x, ry);

    ctx.fillStyle = COLORS.text;
    ctx.font = "600 14px sans-serif";
    ctx.fillText(truncate(ctx, row.name, cols[1].w - 8), cols[1].x, ry);

    ctx.fillStyle = accent;
    ctx.font = "700 14px monospace";
    const val = String(row.value);
    const tw = ctx.measureText(val).width;
    ctx.fillText(val, cols[2].x + cols[2].w - tw, ry);
  });
}

function drawKillersPanel(ctx, x, y, w, h, rows, totalKills) {
  drawPanel(ctx, x, y, w, h, COLORS.killers);

  ctx.fillStyle = COLORS.killers;
  ctx.font = "800 18px sans-serif";
  ctx.fillText("TOP KILLERS", x + 22, y + 34);

  const total = Number(totalKills || 0).toLocaleString("en-US");
  ctx.fillStyle = COLORS.muted;
  ctx.font = "500 12px monospace";
  const totalLabel = `Total Kills: ${total}`;
  ctx.fillText(totalLabel, x + w - 22 - ctx.measureText(totalLabel).width, y + 32);

  const cols = [
    { label: "#", x: x + 22, w: 28, align: "left" },
    { label: "Player", x: x + 56, w: w - 180, align: "left" },
    { label: "Kills", x: x + w - 110, w: 78, align: "right" },
  ];

  ctx.fillStyle = COLORS.faint;
  ctx.font = "600 11px monospace";
  ctx.fillText("#", cols[0].x, y + 58);
  ctx.fillText("Player", cols[1].x, y + 58);
  const killsW = ctx.measureText("Kills").width;
  ctx.fillText("Kills", cols[2].x + cols[2].w - killsW, y + 58);

  ctx.strokeStyle = COLORS.killersDim;
  ctx.beginPath();
  ctx.moveTo(x + 16, y + 68);
  ctx.lineTo(x + w - 16, y + 68);
  ctx.stroke();

  drawRows(ctx, {
    x,
    y: y + 92,
    rowH: 34,
    rows,
    cols,
    accent: COLORS.killers,
    empty: "No kills tracked yet",
  });

  const updated = new Date().toUTCString().replace(/:\d{2} GMT$/, " UTC");
  ctx.fillStyle = COLORS.faint;
  ctx.font = "500 11px monospace";
  ctx.fillText(`Updated @ ${updated}`, x + 22, y + h - 18);
}

function drawSidePanel(ctx, x, y, w, h, { title, accent, valueLabel, rows }) {
  drawPanel(ctx, x, y, w, h, accent);

  ctx.fillStyle = accent;
  ctx.font = "800 15px sans-serif";
  ctx.fillText(title, x + 20, y + 30);

  const cols = [
    { label: "#", x: x + 20, w: 24 },
    { label: "Player", x: x + 48, w: w - 150 },
    { label: valueLabel, x: x + w - 100, w: 72 },
  ];

  ctx.fillStyle = COLORS.faint;
  ctx.font = "600 10px monospace";
  ctx.fillText("#", cols[0].x, y + 52);
  ctx.fillText("Player", cols[1].x, y + 52);
  const lw = ctx.measureText(valueLabel).width;
  ctx.fillText(valueLabel, cols[2].x + cols[2].w - lw, y + 52);

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.moveTo(x + 14, y + 60);
  ctx.lineTo(x + w - 14, y + 60);
  ctx.stroke();

  drawRows(ctx, {
    x,
    y: y + 84,
    rowH: 32,
    rows,
    cols,
    accent,
    empty: "Waiting for data",
  });
}

/**
 * Renders the Astral wipe leaderboard card (kills + K/D + playtime).
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function renderLeaderboardCard() {
  const [kills, kd, playtime, summary] = await Promise.all([
    getLeaderboard("kills", 15),
    getLeaderboard("kd", 5),
    getLeaderboard("playtime", 5),
    statsSummary(),
  ]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx);
  drawHeader(ctx, summary.wipe);

  const topY = 96;
  const leftW = 560;
  const gap = 18;
  const rightX = PAD + leftW + gap;
  const rightW = W - rightX - PAD;
  const leftH = H - topY - PAD;
  const sideH = (leftH - gap) / 2;

  drawKillersPanel(ctx, PAD, topY, leftW, leftH, kills, summary.totalKills);

  drawSidePanel(ctx, rightX, topY, rightW, sideH, {
    title: "TOP SURVIVORS",
    accent: COLORS.kd,
    valueLabel: "K/D",
    rows: kd,
  });

  drawSidePanel(ctx, rightX, topY + sideH + gap, rightW, sideH, {
    title: "TOP PLAYTIME",
    accent: COLORS.play,
    valueLabel: "Time",
    rows: playtime.map((r) => ({
      ...r,
      value: typeof r.numeric === "number" ? formatPlaytime(r.numeric) : r.value,
    })),
  });

  // Brand footer strip
  ctx.fillStyle = COLORS.faint;
  ctx.font = "500 11px monospace";
  const brand = "astral vanilla+  ·  live rcon stats";
  ctx.fillText(brand, W - PAD - ctx.measureText(brand).width, H - 10);

  return canvas.toBuffer("image/png");
}

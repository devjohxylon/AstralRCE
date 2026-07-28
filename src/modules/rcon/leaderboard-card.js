import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import {
  formatPlaytime,
  getLeaderboard,
  statsSummary,
} from "./stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, "../../../assets/fonts");

let fontsReady = false;

function ensureFonts() {
  if (fontsReady) return;
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, "SpaceGrotesk-Bold.ttf"), "Space Grotesk");
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, "SpaceGrotesk-Medium.ttf"), "Space Grotesk");
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, "JetBrainsMono-Regular.ttf"), "JetBrains Mono");
  GlobalFonts.registerFromPath(path.join(FONTS_DIR, "JetBrainsMono-SemiBold.ttf"), "JetBrains Mono");
  fontsReady = true;
}

const W = 980;
const H = 700;
const PAD = 28;

/** Astral Control HUD palette (matches admin panel) */
const T = {
  bg0: "#050506",
  bg1: "#07080a",
  bg2: "#0c0d10",
  panel: "#12141a",
  elev: "#181b22",
  line: "rgba(255,255,255,0.07)",
  line2: "rgba(255,255,255,0.14)",
  text: "#f0f2f5",
  muted: "#9aa0ab",
  faint: "#5e646f",
  chrome: "#d7dde6",
  chromeDim: "#8a93a0",
  info: "#7eb8e8",
  ok: "#5ed9a0",
  bad: "#ff6b73",
  warn: "#e8c06a",
};

const FONT_UI = '"Space Grotesk"';
const FONT_MONO = '"JetBrains Mono"';

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
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#07080a");
  g.addColorStop(0.4, T.bg0);
  g.addColorStop(1, "#040405");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Soft chrome glows (panel theme)
  const orb = (x, y, r, color) => {
    const rad = ctx.createRadialGradient(x, y, 0, x, y, r);
    rad.addColorStop(0, color);
    rad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, W, H);
  };
  orb(110, -40, 420, "rgba(215,221,230,0.08)");
  orb(W, 0, 380, "rgba(255,255,255,0.03)");

  // Fine grid, masked toward center-top like the panel
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = "rgba(255,255,255,0.015)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPanel(ctx, x, y, w, h, accent) {
  fillRoundRect(ctx, x, y, w, h, 6, T.panel);
  strokeRoundRect(ctx, x, y, w, h, 6, T.line, 1);

  // Left chrome accent (matches sidebar active inset)
  ctx.fillStyle = accent;
  ctx.fillRect(x, y + 8, 2, h - 16);
}

function drawHeader(ctx, wipeLabel) {
  ctx.fillStyle = T.chromeDim;
  ctx.font = `600 11px ${FONT_UI}`;
  ctx.letterSpacing = "0.08em";
  ctx.fillText("ASTRAL VANILLA+", PAD, 30);
  ctx.letterSpacing = "0px";

  // Chrome gradient title
  const title = "Leaderboard";
  ctx.font = `700 30px ${FONT_UI}`;
  const grad = ctx.createLinearGradient(PAD, 40, PAD, 70);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#9aa3af");
  ctx.fillStyle = grad;
  ctx.fillText(title, PAD, 62);

  if (wipeLabel) {
    ctx.fillStyle = T.faint;
    ctx.font = `500 11px ${FONT_MONO}`;
    ctx.fillText(`Wipe: ${wipeLabel}`, PAD, 82);
  }
}

function drawRows(ctx, { x, startY, rowH, rows, cols, accent, empty }) {
  if (!rows.length) {
    ctx.fillStyle = T.faint;
    ctx.font = `500 13px ${FONT_UI}`;
    ctx.fillText(empty || "No data yet", x + 20, startY + 20);
    return;
  }

  const innerW = cols[2].x + cols[2].w - x - 12;

  rows.forEach((row, i) => {
    const ry = startY + i * rowH;

    if (i % 2 === 1) {
      fillRoundRect(ctx, x + 10, ry - 15, innerW, rowH - 4, 3, "rgba(255,255,255,0.025)");
    }

    ctx.fillStyle = row.rank <= 3 ? T.warn : T.faint;
    ctx.font = `600 12px ${FONT_MONO}`;
    ctx.fillText(String(row.rank).padStart(2, " "), cols[0].x, ry);

    ctx.fillStyle = T.text;
    ctx.font = `600 14px ${FONT_UI}`;
    ctx.fillText(truncate(ctx, row.name, cols[1].w - 6), cols[1].x, ry);

    ctx.fillStyle = accent;
    ctx.font = `600 13px ${FONT_MONO}`;
    const val = String(row.value);
    ctx.fillText(val, cols[2].x + cols[2].w - ctx.measureText(val).width, ry);
  });
}

function drawColHeaders(ctx, cols, y) {
  ctx.fillStyle = T.faint;
  ctx.font = `600 10px ${FONT_MONO}`;
  for (const col of cols) {
    if (col.align === "right") {
      ctx.fillText(col.label, col.x + col.w - ctx.measureText(col.label).width, y);
    } else {
      ctx.fillText(col.label, col.x, y);
    }
  }
}

function drawKillersPanel(ctx, x, y, w, h, rows, totalKills) {
  drawPanel(ctx, x, y, w, h, T.chrome);

  ctx.fillStyle = T.chrome;
  ctx.font = `700 16px ${FONT_UI}`;
  ctx.fillText("TOP KILLERS", x + 20, y + 32);

  const total = `Total Kills: ${Number(totalKills || 0).toLocaleString("en-US")}`;
  ctx.fillStyle = T.muted;
  ctx.font = `500 11px ${FONT_MONO}`;
  ctx.fillText(total, x + w - 20 - ctx.measureText(total).width, y + 30);

  const cols = [
    { label: "#", x: x + 20, w: 28, align: "left" },
    { label: "PLAYER", x: x + 54, w: w - 170, align: "left" },
    { label: "KILLS", x: x + w - 100, w: 72, align: "right" },
  ];
  drawColHeaders(ctx, cols, y + 56);

  ctx.strokeStyle = T.line;
  ctx.beginPath();
  ctx.moveTo(x + 14, y + 66);
  ctx.lineTo(x + w - 14, y + 66);
  ctx.stroke();

  drawRows(ctx, {
    x,
    startY: y + 90,
    rowH: 33,
    rows,
    cols,
    accent: T.chrome,
    empty: "No kills tracked yet",
  });

  const updated = new Date().toUTCString().replace("GMT", "UTC");
  ctx.fillStyle = T.faint;
  ctx.font = `500 10px ${FONT_MONO}`;
  ctx.fillText(`Updated @ ${updated}`, x + 20, y + h - 16);
}

function drawSidePanel(ctx, x, y, w, h, { title, accent, valueLabel, rows, empty }) {
  drawPanel(ctx, x, y, w, h, accent);

  ctx.fillStyle = accent;
  ctx.font = `700 14px ${FONT_UI}`;
  ctx.fillText(title, x + 18, y + 28);

  const cols = [
    { label: "#", x: x + 18, w: 24, align: "left" },
    { label: "PLAYER", x: x + 46, w: w - 140, align: "left" },
    { label: valueLabel, x: x + w - 92, w: 66, align: "right" },
  ];
  drawColHeaders(ctx, cols, y + 50);

  ctx.strokeStyle = T.line;
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 58);
  ctx.lineTo(x + w - 12, y + 58);
  ctx.stroke();

  drawRows(ctx, {
    x,
    startY: y + 82,
    rowH: 34,
    rows,
    cols,
    accent,
    empty,
  });
}

/**
 * Renders the Astral wipe leaderboard card (kills + K/D + playtime).
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function renderLeaderboardCard() {
  ensureFonts();

  const [kills, kd, playtime, summary] = await Promise.all([
    getLeaderboard("kills", 15),
    getLeaderboard("kd", 5),
    getLeaderboard("playtime", 5),
    statsSummary(),
  ]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  ctx.imageSmoothingEnabled = true;

  drawBackground(ctx);
  drawHeader(ctx, summary.wipe);

  const topY = 100;
  const leftW = 560;
  const gap = 16;
  const rightX = PAD + leftW + gap;
  const rightW = W - rightX - PAD;
  const leftH = H - topY - PAD;
  const sideH = (leftH - gap) / 2;

  drawKillersPanel(ctx, PAD, topY, leftW, leftH, kills, summary.totalKills);

  drawSidePanel(ctx, rightX, topY, rightW, sideH, {
    title: "TOP SURVIVORS",
    accent: T.info,
    valueLabel: "K/D",
    rows: kd,
    empty: "Waiting for K/D data",
  });

  drawSidePanel(ctx, rightX, topY + sideH + gap, rightW, sideH, {
    title: "TOP PLAYTIME",
    accent: T.warn,
    valueLabel: "TIME",
    rows: playtime.map((r) => ({
      ...r,
      value: typeof r.numeric === "number" ? formatPlaytime(r.numeric) : r.value,
    })),
    empty: "Waiting for playtime",
  });

  return canvas.toBuffer("image/png");
}

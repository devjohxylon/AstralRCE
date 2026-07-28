import path from "path";
import { fileURLToPath } from "url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { formatPlaytime, getLeaderboard, statsSummary } from "./stats.js";

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

const W = 720;
const H = 420;
const PAD = 28;
const FONT_UI = '"Space Grotesk"';
const FONT_MONO = '"JetBrains Mono"';

const T = {
  bg0: "#050506",
  panel: "#12141a",
  line: "rgba(255,255,255,0.07)",
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

async function findRank(category, ign) {
  const rows = await getLeaderboard(category, 500);
  const hit = rows.find((r) => r.name.toLowerCase() === String(ign).toLowerCase());
  return hit?.rank ?? null;
}

function drawStatTile(ctx, x, y, w, h, { label, value, accent }) {
  fillRoundRect(ctx, x, y, w, h, 6, "#181b22");
  strokeRoundRect(ctx, x, y, w, h, 6, T.line, 1);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y + 8, 2, h - 16);

  ctx.fillStyle = T.faint;
  ctx.font = `600 11px ${FONT_MONO}`;
  ctx.fillText(label, x + 16, y + 28);

  ctx.fillStyle = T.text;
  ctx.font = `700 28px ${FONT_UI}`;
  ctx.fillText(String(value), x + 16, y + 64);
}

/**
 * Personal wipe stats card in the same Astral HUD style as the wipe leaderboard.
 * @param {object} card from getPlayerCard
 * @returns {Promise<Buffer>}
 */
export async function renderPlayerStatsCard(card) {
  ensureFonts();
  const summary = await statsSummary();
  const [killsRank, kdRank, playRank] = await Promise.all([
    findRank("kills", card.name),
    findRank("kd", card.name),
    findRank("playtime", card.name),
  ]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#07080a");
  bg.addColorStop(0.45, T.bg0);
  bg.addColorStop(1, "#040405");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const orb = ctx.createRadialGradient(80, -20, 0, 80, -20, 320);
  orb.addColorStop(0, "rgba(215,221,230,0.08)");
  orb.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, W, H);

  // Main panel
  fillRoundRect(ctx, PAD, PAD, W - PAD * 2, H - PAD * 2, 6, T.panel);
  strokeRoundRect(ctx, PAD, PAD, W - PAD * 2, H - PAD * 2, 6, T.line, 1);
  ctx.fillStyle = T.chrome;
  ctx.fillRect(PAD, PAD + 10, 2, H - PAD * 2 - 20);

  ctx.fillStyle = T.chromeDim || T.muted;
  ctx.font = `600 11px ${FONT_UI}`;
  ctx.fillText("ASTRAL VANILLA+", PAD + 22, PAD + 28);

  const titleGrad = ctx.createLinearGradient(PAD + 22, PAD + 36, PAD + 22, PAD + 68);
  titleGrad.addColorStop(0, "#ffffff");
  titleGrad.addColorStop(1, "#9aa3af");
  ctx.fillStyle = titleGrad;
  ctx.font = `700 28px ${FONT_UI}`;
  ctx.fillText(card.name, PAD + 22, PAD + 58);

  ctx.fillStyle = T.faint;
  ctx.font = `500 11px ${FONT_MONO}`;
  const wipe = summary.wipe ? `Wipe: ${summary.wipe}` : "Wipe: current";
  ctx.fillText(wipe, PAD + 22, PAD + 78);

  // Rank chips
  const chips = [
    { label: killsRank ? `#${killsRank} Kills` : "Unranked Kills", color: T.chrome },
    { label: kdRank ? `#${kdRank} K/D` : "Unranked K/D", color: T.info },
    { label: playRank ? `#${playRank} Playtime` : "Unranked Time", color: T.warn },
  ];
  let chipX = PAD + 22;
  const chipY = PAD + 96;
  ctx.font = `600 11px ${FONT_MONO}`;
  for (const chip of chips) {
    const tw = ctx.measureText(chip.label).width;
    const cw = tw + 18;
    fillRoundRect(ctx, chipX, chipY, cw, 24, 4, "rgba(255,255,255,0.04)");
    strokeRoundRect(ctx, chipX, chipY, cw, 24, 4, T.line, 1);
    ctx.fillStyle = chip.color;
    ctx.fillText(chip.label, chipX + 9, chipY + 16);
    chipX += cw + 8;
  }

  const tileW = 200;
  const tileH = 88;
  const gap = 14;
  const gridX = PAD + 22;
  const gridY = PAD + 140;

  drawStatTile(ctx, gridX, gridY, tileW, tileH, {
    label: "KILLS",
    value: card.kills ?? 0,
    accent: T.chrome,
  });
  drawStatTile(ctx, gridX + tileW + gap, gridY, tileW, tileH, {
    label: "DEATHS",
    value: card.deaths ?? 0,
    accent: T.bad,
  });
  drawStatTile(ctx, gridX + (tileW + gap) * 2, gridY, tileW, tileH, {
    label: "K/D",
    value: card.kd ?? "0.00",
    accent: T.info,
  });

  drawStatTile(ctx, gridX, gridY + tileH + gap, tileW, tileH, {
    label: "PLAYTIME",
    value: formatPlaytime(card.playtimeMs || 0),
    accent: T.warn,
  });
  drawStatTile(ctx, gridX + tileW + gap, gridY + tileH + gap, tileW, tileH, {
    label: "NPC KILLS",
    value: card.npcKills ?? 0,
    accent: T.ok,
  });
  drawStatTile(ctx, gridX + (tileW + gap) * 2, gridY + tileH + gap, tileW, tileH, {
    label: "SUICIDES",
    value: card.suicides ?? 0,
    accent: T.muted,
  });

  return canvas.toBuffer("image/png");
}

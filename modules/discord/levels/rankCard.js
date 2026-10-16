// modules/discord/levels/rankCard.js
// Renders a MEE6-style rank card via @napi-rs/canvas. If the native canvas
// module isn't available, buildRankCard returns null and callers fall back to
// a plain embed.

const levelStore = require("./levelStore");

let canvas = null;
try {
  canvas = require("@napi-rs/canvas");
} catch {
  canvas = null;
}

function abbrev(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

/**
 * @returns {Promise<Buffer|null>} PNG buffer, or null if canvas is unavailable.
 */
async function buildRankCard({ user, record, rank, totalMembers }) {
  if (!canvas) return null;
  const { createCanvas, GlobalFonts, loadImage } = canvas;

  const W = 900;
  const H = 260;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");

  // Background
  ctx.fillStyle = "#23272A";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2C2F33";
  roundRect(ctx, 20, 20, W - 40, H - 40, 20);
  ctx.fill();

  // Avatar
  try {
    const avatarUrl = user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true });
    const img = await loadImage(avatarUrl);
    const size = 160;
    const ax = 50;
    const ay = 50;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, ax, ay, size, size);
    ctx.restore();
    ctx.strokeStyle = "#5865F2";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
    ctx.stroke();
  } catch {
    /* avatar failed to load — continue without it */
  }

  const info = levelStore.levelFromXp(record.xp);
  const textX = 240;

  // Username
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 40px sans-serif";
  const name = (user.username || "User").slice(0, 20);
  ctx.fillText(name, textX, 90);

  // Rank + level (top right)
  ctx.textAlign = "right";
  ctx.font = "bold 34px sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(`LEVEL ${info.level}`, W - 50, 80);
  ctx.fillStyle = "#B9BBBE";
  ctx.font = "26px sans-serif";
  ctx.fillText(`RANK #${rank || "?"}${totalMembers ? ` / ${totalMembers}` : ""}`, W - 50, 115);
  ctx.textAlign = "left";

  // Progress bar
  const barX = textX;
  const barY = 150;
  const barW = W - textX - 50;
  const barH = 34;
  ctx.fillStyle = "#484B4E";
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();

  const pct = info.needed > 0 ? Math.min(1, info.intoLevel / info.needed) : 0;
  if (pct > 0) {
    ctx.fillStyle = "#5865F2";
    roundRect(ctx, barX, barY, Math.max(barH, barW * pct), barH, barH / 2);
    ctx.fill();
  }

  // XP text
  ctx.fillStyle = "#DCDDDE";
  ctx.font = "22px sans-serif";
  ctx.fillText(`${abbrev(info.intoLevel)} / ${abbrev(info.needed)} XP`, barX, barY + barH + 30);
  ctx.textAlign = "right";
  ctx.fillText(`Total: ${abbrev(record.xp)} XP`, W - 50, barY + barH + 30);
  ctx.textAlign = "left";

  return cv.encode("png");
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

module.exports = { buildRankCard, available: !!canvas };

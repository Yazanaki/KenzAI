// modules/yazanaki/squadrontree.js
// Canvas org-chart renderer for military chain-of-command trees, in the
// Yazanaki dark palette. Draws any render model produced by
// squadronlogic.buildTreeModel / buildChainModel:
//   { id, tier, name, avatarURL, present, color, children: [...] }
//
// Layout is a classic tidy org chart: leaves get evenly spaced columns and
// each parent is centred over its children. Slot width shrinks as the tree
// grows so the image stays bounded. Modeled on modules/stock/chart.js.

const { createCanvas, loadImage } = require("@napi-rs/canvas");

// Yazanaki palette (shared with stock/chart.js).
const BG_TOP = "#16161a";
const BG_BOTTOM = "#0a0a0c";
const CARD_BG = "#1c1c22";
const TEXT = "#f5f5f7";
const TEXT_DIM = "rgba(255,255,255,0.5)";
const LINE = "rgba(255,255,255,0.22)";
const WHITE = "#ffffff";

// Default tier accents (used when the model node has no explicit color).
const TIER_COLOR = {
  high_general: "#3fb6c9",
  general: "#a06bff",
  captain: "#ff8a3d",
  imperial_army: "#c9e04d",
  recruit: "#57c96b",
};
const TIER_LABEL = {
  high_general: "High General",
  general: "General",
  captain: "Captain",
  imperial_army: "Imperial Army",
  recruit: "Recruit",
};

const MARGIN_X = 44;
const TOP_PAD = 78; // room for the title band
const BOTTOM_PAD = 34;
const LEVEL_H = 152; // vertical distance between tiers
const BOX_H = 100;
const MAX_WIDTH = 2200;
const MIN_SLOT = 74;
const MAX_SLOT = 172;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function tierColor(node) {
  return node.color || TIER_COLOR[node.tier] || "#888";
}

function initialsOf(name) {
  const parts = String(name || "?").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join("").toUpperCase() || "?";
}

function truncate(ctx, text, maxW) {
  let t = String(text == null ? "" : text);
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

// ---- layout ----------------------------------------------------------------

/** Assign each node a leaf-order x (fractional for parents) + depth. */
function layout(root) {
  let nextLeaf = 0;
  let maxDepth = 0;
  const all = [];
  (function walk(node, depth) {
    node._depth = depth;
    maxDepth = Math.max(maxDepth, depth);
    if (!node.children || !node.children.length) {
      node._x = nextLeaf++;
    } else {
      node.children.forEach((c) => walk(c, depth + 1));
      node._x = (node.children[0]._x + node.children[node.children.length - 1]._x) / 2;
    }
    all.push(node);
  })(root, 0);
  return { leaves: Math.max(1, nextLeaf), maxDepth, all };
}

// ---- avatars ---------------------------------------------------------------

async function preloadAvatars(nodes) {
  const urls = [...new Set(nodes.map((n) => n.avatarURL).filter(Boolean))];
  const map = new Map();
  await Promise.all(
    urls.map(async (url) => {
      try {
        map.set(url, await loadImage(url));
      } catch {
        /* fall back to initials */
      }
    })
  );
  return map;
}

// ---- drawing ---------------------------------------------------------------

function drawBackground(ctx, w, h) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, BG_TOP);
  bg.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(w * 0.5, 0, 0, w * 0.5, 0, w * 0.7);
  glow.addColorStop(0, "rgba(212,0,0,0.12)");
  glow.addColorStop(1, "rgba(212,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

function drawTitle(ctx, w, title, subtitle) {
  ctx.textAlign = "left";
  ctx.fillStyle = TEXT;
  ctx.font = "bold 26px sans-serif";
  ctx.fillText(title || "Chain of Command", MARGIN_X, 40);
  if (subtitle) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "14px sans-serif";
    ctx.fillText(subtitle, MARGIN_X, 62);
  }
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(MARGIN_X, 70, w - MARGIN_X * 2, 1);
}

function drawConnectors(ctx, all, xOf, yOf) {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const node of all) {
    if (!node.children || !node.children.length) continue;
    const px = xOf(node);
    const pBottom = yOf(node) + BOX_H;
    for (const child of node.children) {
      const cx = xOf(child);
      const cTop = yOf(child);
      const midY = pBottom + (cTop - pBottom) / 2;
      ctx.beginPath();
      ctx.moveTo(px, pBottom);
      ctx.lineTo(px, midY);
      ctx.lineTo(cx, midY);
      ctx.lineTo(cx, cTop);
      ctx.stroke();
    }
  }
}

/** A collapsed group ("+3 Captains", "5 Soldiers · 12 Recruits") drawn as a stack. */
function drawBundle(ctx, node, cx, top, boxW) {
  const accent = tierColor(node);
  const x = cx - boxW / 2;

  // Stacked cards behind, to signal a group.
  for (let k = 2; k >= 1; k--) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = CARD_BG;
    roundRectPath(ctx, x + k * 5, top - k * 5, boxW, BOX_H, 12);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // Main card with a dashed accent border.
  ctx.fillStyle = CARD_BG;
  roundRectPath(ctx, x, top, boxW, BOX_H, 12);
  ctx.fill();
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.6;
  roundRectPath(ctx, x, top, boxW, BOX_H, 12);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = accent;
  ctx.font = "bold 19px sans-serif";
  ctx.fillText(truncate(ctx, node.name || "", boxW - 14), cx, top + (node.sub ? 46 : BOX_H / 2 + 7));
  if (node.sub) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "12px sans-serif";
    ctx.fillText(truncate(ctx, node.sub, boxW - 14), cx, top + 68);
  }
}

function drawNode(ctx, node, cx, top, boxW, images, highlightId) {
  if (node.bundle) return drawBundle(ctx, node, cx, top, boxW);

  const x = cx - boxW / 2;
  const accent = tierColor(node);
  const isFocus = highlightId && node.id === highlightId;

  // Card
  ctx.save();
  if (isFocus) {
    ctx.shadowColor = accent;
    ctx.shadowBlur = 16;
  }
  ctx.fillStyle = CARD_BG;
  roundRectPath(ctx, x, top, boxW, BOX_H, 12);
  ctx.fill();
  ctx.restore();

  // Accent border (thicker + white ring if focused)
  roundRectPath(ctx, x, top, boxW, BOX_H, 12);
  ctx.lineWidth = isFocus ? 3 : 1.6;
  ctx.strokeStyle = isFocus ? WHITE : accent;
  ctx.stroke();

  // Top accent bar
  ctx.save();
  roundRectPath(ctx, x, top, boxW, BOX_H, 12);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.fillRect(x, top, boxW, 4);
  ctx.restore();

  // Avatar (circular) centered near the top
  const d = Math.min(46, boxW * 0.5);
  const acx = cx;
  const acy = top + 16 + d / 2;
  const img = node.avatarURL ? images.get(node.avatarURL) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(acx, acy, d / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, acx - d / 2, acy - d / 2, d, d);
  } else {
    ctx.fillStyle = accent;
    ctx.fillRect(acx - d / 2, acy - d / 2, d, d);
    ctx.fillStyle = "#101014";
    ctx.font = `bold ${Math.round(d * 0.4)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initialsOf(node.name), acx, acy + 1);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  // ring around avatar
  ctx.beginPath();
  ctx.arc(acx, acy, d / 2, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.stroke();

  // Name
  ctx.textAlign = "center";
  ctx.fillStyle = node.present === false ? TEXT_DIM : TEXT;
  ctx.font = "bold 13px sans-serif";
  ctx.fillText(truncate(ctx, node.name, boxW - 12), cx, top + 16 + d + 16);

  // Rank label
  ctx.fillStyle = accent;
  ctx.font = "11px sans-serif";
  ctx.fillText(truncate(ctx, TIER_LABEL[node.tier] || "", boxW - 12), cx, top + 16 + d + 32);
}

/**
 * Render a chain-of-command model to a PNG buffer.
 * @param {object} model  render tree (root node)
 * @param {object} opts   { title, subtitle, highlightId }
 * @returns {Promise<Buffer>}
 */
async function renderTree(model, opts = {}) {
  const { leaves, maxDepth, all } = layout(model);

  const slot = clamp(Math.floor(MAX_WIDTH / leaves), MIN_SLOT, MAX_SLOT);
  const boxW = Math.min(slot - 14, 158);

  const width = Math.max(560, MARGIN_X * 2 + leaves * slot);
  const height = TOP_PAD + maxDepth * LEVEL_H + BOX_H + BOTTOM_PAD;

  const xOf = (node) => MARGIN_X + (node._x + 0.5) * slot;
  const yOf = (node) => TOP_PAD + node._depth * LEVEL_H;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, width, height);
  drawTitle(ctx, width, opts.title, opts.subtitle);

  const images = await preloadAvatars(all);

  drawConnectors(ctx, all, xOf, yOf);
  for (const node of all) drawNode(ctx, node, xOf(node), yOf(node), boxW, images, opts.highlightId);

  return canvas.toBuffer("image/png");
}

module.exports = { renderTree, TIER_COLOR, TIER_LABEL };

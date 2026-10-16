// modules/discord/common/util.js
// Small shared helpers for the Discord module. No Discord.js dependency here so
// these stay trivially unit-testable and cheap to require.

/** Generate a short, sortable-ish unique id with a prefix (e.g. "case"). */
function genId(prefix = "id") {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Composite key for per-guild-per-user stores. */
function memberKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

const DURATION_UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };

/**
 * Parse a human duration like "10m", "2h30m", "1d", "45s" into milliseconds.
 * Returns null when nothing parseable is found.
 */
function parseDuration(input) {
  if (input == null) return null;
  const str = String(input).trim().toLowerCase();
  if (!str) return null;
  const re = /(\d+)\s*(w|d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(str)) !== null) {
    matched = true;
    total += Number(m[1]) * DURATION_UNITS[m[2]];
  }
  if (!matched) {
    // bare number => minutes
    const n = Number(str);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 60000);
    return null;
  }
  return total > 0 ? total : null;
}

/** Format a millisecond duration into a compact human string ("1d 2h 3m"). */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const units = [
    ["w", DURATION_UNITS.w],
    ["d", DURATION_UNITS.d],
    ["h", DURATION_UNITS.h],
    ["m", DURATION_UNITS.m],
    ["s", DURATION_UNITS.s],
  ];
  const parts = [];
  let rem = Math.floor(ms);
  for (const [label, size] of units) {
    if (rem >= size) {
      const v = Math.floor(rem / size);
      rem -= v * size;
      parts.push(`${v}${label}`);
    }
    if (parts.length >= 2) break; // keep it short
  }
  return parts.length ? parts.join(" ") : "0s";
}

/** Recursively merge `override` onto a deep copy of `base`. Arrays are replaced. */
function deepMerge(base, override) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (override == null || typeof override !== "object") return out;
  for (const key of Object.keys(override)) {
    const ov = override[key];
    const bv = out[key];
    if (
      ov &&
      typeof ov === "object" &&
      !Array.isArray(ov) &&
      bv &&
      typeof bv === "object" &&
      !Array.isArray(bv)
    ) {
      out[key] = deepMerge(bv, ov);
    } else if (Array.isArray(ov)) {
      out[key] = ov.slice();
    } else {
      out[key] = ov;
    }
  }
  return out;
}

/** Split an array into chunks of `size`. */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Clamp n into [min, max]. */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/** Pick a random integer in [min, max] inclusive. */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  genId,
  memberKey,
  parseDuration,
  formatDuration,
  deepMerge,
  chunk,
  clamp,
  randInt,
};

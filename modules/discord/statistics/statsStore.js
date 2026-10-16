// modules/discord/statistics/statsStore.js
// Per-guild statistics counters over the `discord_stats` store. High-frequency
// events (messages, voice seconds) are buffered in memory and flushed on an
// interval so we don't write the JSON file on every message. Low-frequency
// events (joins/leaves) are written immediately. `data.daily` keeps rolling
// per-day buckets (last 30 days).

const { stores } = require("../../database/stores");

const store = () => stores.discord_stats;
const DAILY_KEEP = 30;

const pendingMessages = new Map(); // guildId -> count
const pendingVoice = new Map(); // guildId -> seconds
let flushTimer = null;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function base(guildId) {
  return { guildId, joins: 0, leaves: 0, messages: 0, voiceSeconds: 0, daily: {} };
}

function all() {
  return store().readMap();
}

function get(guildId) {
  const rec = all()[guildId];
  return rec ? { ...base(guildId), ...rec } : base(guildId);
}

function pruneDaily(daily) {
  const keys = Object.keys(daily).sort();
  while (keys.length > DAILY_KEEP) delete daily[keys.shift()];
}

/** Apply a set of field deltas to a guild's record (reads + writes once). */
function apply(guildId, deltas) {
  const map = all();
  const rec = map[guildId] ? { ...base(guildId), ...map[guildId] } : base(guildId);
  const day = todayKey();
  if (!rec.daily[day]) rec.daily[day] = { joins: 0, leaves: 0, messages: 0, voiceSeconds: 0 };
  for (const [field, n] of Object.entries(deltas)) {
    rec[field] = (rec[field] || 0) + n;
    rec.daily[day][field] = (rec.daily[day][field] || 0) + n;
  }
  pruneDaily(rec.daily);
  map[guildId] = rec;
  store().writeMap(map);
}

// ---- buffered (high frequency) ----
function recordMessage(guildId) {
  pendingMessages.set(guildId, (pendingMessages.get(guildId) || 0) + 1);
}
function recordVoiceSeconds(guildId, seconds) {
  if (seconds > 0) pendingVoice.set(guildId, (pendingVoice.get(guildId) || 0) + seconds);
}

// ---- immediate (low frequency) ----
function recordJoin(guildId) {
  apply(guildId, { joins: 1 });
}
function recordLeave(guildId) {
  apply(guildId, { leaves: 1 });
}

function flush() {
  const guildIds = new Set([...pendingMessages.keys(), ...pendingVoice.keys()]);
  for (const guildId of guildIds) {
    const deltas = {};
    const m = pendingMessages.get(guildId) || 0;
    const v = pendingVoice.get(guildId) || 0;
    if (m) deltas.messages = m;
    if (v) deltas.voiceSeconds = v;
    if (Object.keys(deltas).length) apply(guildId, deltas);
  }
  pendingMessages.clear();
  pendingVoice.clear();
}

function startFlush(intervalMs = 60000) {
  if (flushTimer) return;
  flushTimer = setInterval(flush, intervalMs);
}

function stopFlush() {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}

/** Sum a field over the last `days` daily buckets (including today). */
function rangeSum(guildId, field, days) {
  const rec = get(guildId);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  let sum = 0;
  for (const [day, bucket] of Object.entries(rec.daily || {})) {
    if (day >= cutoffKey) sum += bucket[field] || 0;
  }
  return sum;
}

module.exports = {
  get,
  recordMessage,
  recordVoiceSeconds,
  recordJoin,
  recordLeave,
  flush,
  startFlush,
  stopFlush,
  rangeSum,
};

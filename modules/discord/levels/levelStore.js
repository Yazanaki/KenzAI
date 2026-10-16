// modules/discord/levels/levelStore.js
// XP + level persistence (message + voice) over the `discord_levels` hybrid
// store, keyed by "<guildId>:<userId>". Level curve mirrors the familiar
// MEE6-style quadratic: xp to advance FROM level n is 5n² + 50n + 100.

const { stores } = require("../../database/stores");
const { memberKey } = require("../common/util");

const store = () => stores.discord_levels;

/** XP required to advance from `level` to `level + 1`. */
function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

/** Total cumulative XP needed to *reach* `level`. */
function totalXpForLevel(level) {
  let total = 0;
  for (let i = 0; i < level; i++) total += xpForLevel(i);
  return total;
}

/** Resolve a total XP amount into a level and progress within that level. */
function levelFromXp(xp) {
  let level = 0;
  let remaining = xp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return { level, intoLevel: remaining, needed: xpForLevel(level) };
}

function defaultRecord(guildId, userId) {
  return { guildId, userId, xp: 0, level: 0, messages: 0, voiceSeconds: 0 };
}

function all() {
  return store().readMap();
}

function get(guildId, userId) {
  const rec = all()[memberKey(guildId, userId)];
  return rec ? { ...defaultRecord(guildId, userId), ...rec } : defaultRecord(guildId, userId);
}

/**
 * Add XP (and optionally message/voice counters) to a member.
 * @returns {{ record, leveledUp, oldLevel, newLevel }}
 */
function addXp(guildId, userId, amount, opts = {}) {
  const map = all();
  const key = memberKey(guildId, userId);
  const rec = map[key] ? { ...defaultRecord(guildId, userId), ...map[key] } : defaultRecord(guildId, userId);

  const oldLevel = rec.level;
  rec.xp = Math.max(0, rec.xp + Math.round(amount));
  if (opts.incMessages) rec.messages = (rec.messages || 0) + opts.incMessages;
  if (opts.incVoiceSeconds) rec.voiceSeconds = (rec.voiceSeconds || 0) + opts.incVoiceSeconds;
  rec.level = levelFromXp(rec.xp).level;

  map[key] = rec;
  store().writeMap(map);
  return { record: rec, leveledUp: rec.level > oldLevel, oldLevel, newLevel: rec.level };
}

/** Admin: set a member's XP directly (recomputes level). */
function setXp(guildId, userId, xp) {
  const map = all();
  const key = memberKey(guildId, userId);
  const rec = map[key] ? { ...defaultRecord(guildId, userId), ...map[key] } : defaultRecord(guildId, userId);
  rec.xp = Math.max(0, Math.round(xp));
  rec.level = levelFromXp(rec.xp).level;
  map[key] = rec;
  store().writeMap(map);
  return rec;
}

function forGuild(guildId) {
  return Object.values(all()).filter((r) => r && r.guildId === guildId);
}

/** Sorted leaderboard for a metric ("xp" | "messages" | "voiceSeconds"). */
function top(guildId, metric = "xp") {
  return forGuild(guildId).sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
}

/** 1-based rank of a member by XP (0 if they have no record). */
function rankOf(guildId, userId) {
  const sorted = top(guildId, "xp");
  const idx = sorted.findIndex((r) => r.userId === userId);
  return idx === -1 ? 0 : idx + 1;
}

module.exports = {
  xpForLevel,
  totalXpForLevel,
  levelFromXp,
  get,
  addXp,
  setXp,
  forGuild,
  top,
  rankOf,
};

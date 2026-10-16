// modules/discord/moderation/infractionsStore.js
// CRUD over the `discord_infractions` hybrid store. Each record:
//   { caseId, caseNumber, guildId, userId, moderatorId, action, reason,
//     durationMs, active, createdAt, expiresAt }

const { stores } = require("../../database/stores");
const { genId } = require("../common/util");

const store = () => stores.discord_infractions;

function all() {
  return store().readMap();
}

function get(caseId) {
  return all()[caseId] || null;
}

function forGuild(guildId) {
  return Object.values(all()).filter((r) => r && r.guildId === guildId);
}

function forUser(guildId, userId) {
  return forGuild(guildId)
    .filter((r) => r.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function nextCaseNumber(guildId) {
  const nums = forGuild(guildId).map((r) => r.caseNumber || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

/** Persist a new infraction. Fills caseId/caseNumber/createdAt if absent. */
function create(data) {
  const map = all();
  const record = {
    caseId: data.caseId || genId("case"),
    caseNumber: data.caseNumber || nextCaseNumber(data.guildId),
    guildId: data.guildId,
    userId: data.userId,
    moderatorId: data.moderatorId,
    action: data.action,
    reason: data.reason || "No reason provided",
    durationMs: data.durationMs || null,
    active: data.active !== false,
    createdAt: data.createdAt || new Date().toISOString(),
    expiresAt: data.expiresAt || null,
  };
  map[record.caseId] = record;
  store().writeMap(map);
  return record;
}

function update(caseId, patch) {
  const map = all();
  if (!map[caseId]) return null;
  map[caseId] = { ...map[caseId], ...patch };
  store().writeMap(map);
  return map[caseId];
}

function remove(caseId) {
  const map = all();
  const rec = map[caseId] || null;
  if (rec) {
    delete map[caseId];
    store().writeMap(map);
  }
  return rec;
}

/** Remove every infraction for a user; returns how many were removed. */
function clearUser(guildId, userId) {
  const map = all();
  let removed = 0;
  for (const [id, rec] of Object.entries(map)) {
    if (rec && rec.guildId === guildId && rec.userId === userId) {
      delete map[id];
      removed++;
    }
  }
  if (removed) store().writeMap(map);
  return removed;
}

module.exports = {
  get,
  forGuild,
  forUser,
  nextCaseNumber,
  create,
  update,
  remove,
  clearUser,
};

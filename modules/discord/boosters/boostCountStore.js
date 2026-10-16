// modules/discord/boosters/boostCountStore.js
// Per-member boost counts over `discord_boost_counts`, keyed "<guildId>:<userId>".
// Discord exposes no per-member boost count, so this is populated from observed
// GuildBoost system messages (and admin seeding).

const { stores } = require("../../database/stores");
const { memberKey } = require("../common/util");

const store = () => stores.discord_boost_counts;

function all() {
  return store().readMap();
}

function get(guildId, userId) {
  return all()[memberKey(guildId, userId)] || null;
}

function getCount(guildId, userId) {
  return get(guildId, userId)?.count || 0;
}

function set(guildId, userId, count) {
  const map = all();
  const key = memberKey(guildId, userId);
  map[key] = { guildId, userId, count: Math.max(0, Math.round(count)), updatedAt: new Date().toISOString() };
  store().writeMap(map);
  return map[key].count;
}

function increment(guildId, userId, by = 1) {
  return set(guildId, userId, getCount(guildId, userId) + by);
}

function remove(guildId, userId) {
  const map = all();
  const key = memberKey(guildId, userId);
  if (map[key]) {
    delete map[key];
    store().writeMap(map);
  }
}

function forGuild(guildId) {
  return Object.values(all()).filter((r) => r && r.guildId === guildId);
}

module.exports = { get, getCount, set, increment, remove, forGuild };

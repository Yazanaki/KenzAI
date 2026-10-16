// modules/discord/boosters/boostRoleStore.js
// Tracks each booster's personal role over the `discord_booster_roles` store,
// keyed by "<guildId>:<userId>" → { guildId, userId, roleId, createdAt }.

const { stores } = require("../../database/stores");
const { memberKey } = require("../common/util");

const store = () => stores.discord_booster_roles;

function all() {
  return store().readMap();
}

function get(guildId, userId) {
  return all()[memberKey(guildId, userId)] || null;
}

function set(guildId, userId, roleId) {
  const map = all();
  map[memberKey(guildId, userId)] = { guildId, userId, roleId, createdAt: new Date().toISOString() };
  store().writeMap(map);
}

function remove(guildId, userId) {
  const map = all();
  const key = memberKey(guildId, userId);
  const rec = map[key] || null;
  if (rec) {
    delete map[key];
    store().writeMap(map);
  }
  return rec;
}

function forGuild(guildId) {
  return Object.values(all()).filter((r) => r && r.guildId === guildId);
}

module.exports = { get, set, remove, forGuild };

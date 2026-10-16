// modules/discord/giveaways/templates/templates.js
// Reusable giveaway templates over the `discord_giveaway_templates` store,
// keyed by "<guildId>:<lowercased name>". A template captures the prize,
// winner count, duration, and entry requirements so a recurring giveaway can be
// launched with one option.

const { stores } = require("../../../database/stores");

const store = () => stores.discord_giveaway_templates;
const key = (guildId, name) => `${guildId}:${String(name).toLowerCase()}`;

function all() {
  return store().readMap();
}

function save(guildId, name, config) {
  const map = all();
  map[key(guildId, name)] = { guildId, name, ...config };
  store().writeMap(map);
}

function get(guildId, name) {
  return all()[key(guildId, name)] || null;
}

function remove(guildId, name) {
  const map = all();
  const k = key(guildId, name);
  if (map[k]) {
    delete map[k];
    store().writeMap(map);
    return true;
  }
  return false;
}

function list(guildId) {
  return Object.values(all()).filter((t) => t && t.guildId === guildId);
}

module.exports = { save, get, remove, list };

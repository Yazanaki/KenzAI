// modules/discord/settings/settingsStore.js
// Per-guild settings access for the whole Discord module. Backed by the
// `discord_settings` hybrid MapStore (JSON-first, opt-in MySQL mirror).
//
// Reads deep-merge stored overrides under DEFAULT_SETTINGS, so newly added
// default keys automatically appear for existing guilds without a data
// migration. Writes persist the full (merged + mutated) object.

const { stores } = require("../../database/stores");
const { DEFAULT_SETTINGS } = require("../discordconfig");
const { deepMerge } = require("../common/util");

const store = () => stores.discord_settings;

/** Raw stored override object for a guild (may be partial / empty). */
function readRaw(guildId) {
  const map = store().readMap();
  return map[guildId] || {};
}

/** Full, defaults-merged settings for a guild (safe to read any nested key). */
function getGuildSettings(guildId) {
  return deepMerge(DEFAULT_SETTINGS, readRaw(guildId));
}

/**
 * Mutate a guild's settings. `mutator` receives the merged settings object and
 * may mutate it in place (or return a replacement). The result is persisted.
 * @returns the persisted settings object.
 */
function updateGuildSettings(guildId, mutator) {
  const settings = getGuildSettings(guildId);
  const next = typeof mutator === "function" ? mutator(settings) || settings : deepMerge(settings, mutator);
  const map = store().readMap();
  map[guildId] = next;
  store().writeMap(map);
  return next;
}

/** Convenience: read a single feature block (e.g. "leveling"). */
function getFeature(guildId, feature) {
  return getGuildSettings(guildId)[feature];
}

module.exports = { getGuildSettings, updateGuildSettings, getFeature, readRaw };

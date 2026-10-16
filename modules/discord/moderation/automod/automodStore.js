// modules/discord/moderation/automod/automodStore.js
// Thin accessor over the per-guild automod config, which lives inside the
// shared discord_settings store (settings.automod). Keeping it here lets the
// automod command/rules import a focused API without touching the whole
// settings object.

const { getGuildSettings, updateGuildSettings } = require("../../settings/settingsStore");

function getAutomod(guildId) {
  return getGuildSettings(guildId).automod;
}

/** Mutate settings.automod in place via `fn(automod)`; persists and returns it. */
function updateAutomod(guildId, fn) {
  const next = updateGuildSettings(guildId, (s) => {
    fn(s.automod);
    return s;
  });
  return next.automod;
}

module.exports = { getAutomod, updateAutomod };

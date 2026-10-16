// modules/onboarding/onboardingconfig.js
// Read/write helpers for the onboarding channel tours.
//
// Stored inside channels.json (the channels_config singleton store) under a new
// "onboarding" key — no schema change needed, the whole object is persisted as
// one JSON blob:
//
//   onboarding: {
//     empire: [ { channelId, title, description }, ... ],          // shared, Yazanaki Empire
//     clans:  { "<clanGuildId>": [ { channelId, title, description }, ... ] }
//   }
//
// Tour order = array order (insertion order).

const channels = require("../data/channels");

const EMPIRE_PATH = "onboarding.empire";
const clanPath = (guildId) => `onboarding.clans.${guildId}`;

/**
 * Return the shared Yazanaki Empire tour (always an array).
 */
function getEmpireTour() {
  const list = channels.get(EMPIRE_PATH);
  return Array.isArray(list) ? list : [];
}

/**
 * Return a clan's tour by clan guild ID (always an array).
 */
function getClanTour(guildId) {
  if (!guildId) return [];
  const list = channels.get(clanPath(guildId));
  return Array.isArray(list) ? list : [];
}

function getTour(scope, guildId) {
  return scope === "empire" ? getEmpireTour() : getClanTour(guildId);
}

function setTour(scope, guildId, list) {
  if (scope === "empire") {
    channels.set(EMPIRE_PATH, list);
  } else {
    channels.set(clanPath(guildId), list);
  }
}

/**
 * Add (or update) a channel in a tour.
 * If the channel already exists in the tour, its title/description are updated
 * in place (keeping its position); otherwise it is appended to the end.
 *
 * @param {"empire"|"clan"} scope
 * @param {string|null} guildId  clan guild ID (ignored for empire scope)
 * @param {{channelId:string,title:string,description:string}} entry
 * @returns {{list:Array, updated:boolean}}
 */
function addChannel(scope, guildId, entry) {
  const list = getTour(scope, guildId);
  const idx = list.findIndex((e) => e.channelId === entry.channelId);
  let updated = false;
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...entry };
    updated = true;
  } else {
    list.push(entry);
  }
  setTour(scope, guildId, list);
  return { list, updated };
}

/**
 * Remove a channel from a tour by channel ID.
 * @returns {{list:Array, removed:boolean}}
 */
function removeChannel(scope, guildId, channelId) {
  const list = getTour(scope, guildId);
  const next = list.filter((e) => e.channelId !== channelId);
  const removed = next.length !== list.length;
  if (removed) setTour(scope, guildId, next);
  return { list: next, removed };
}

module.exports = {
  getEmpireTour,
  getClanTour,
  getTour,
  addChannel,
  removeChannel,
};

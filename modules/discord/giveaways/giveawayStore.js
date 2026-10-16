// modules/discord/giveaways/giveawayStore.js
// CRUD over the `discord_giveaways` hybrid store, keyed by the giveaway's
// message id. Record shape:
//   { messageId, guildId, channelId, prize, winnerCount, hostId, endsAt,
//     status: "active"|"ended"|"cancelled", entries: [userId],
//     requiredRoleId, requiredLevel, winnerIds: [], createdAt, endedAt }

const { stores } = require("../../database/stores");

const store = () => stores.discord_giveaways;

function all() {
  return store().readMap();
}

function get(messageId) {
  return all()[messageId] || null;
}

function save(record) {
  const map = all();
  map[record.messageId] = record;
  store().writeMap(map);
  return record;
}

function remove(messageId) {
  const map = all();
  if (map[messageId]) {
    delete map[messageId];
    store().writeMap(map);
  }
}

function forGuild(guildId) {
  return Object.values(all()).filter((g) => g && g.guildId === guildId);
}

function activeForGuild(guildId) {
  return forGuild(guildId).filter((g) => g.status === "active");
}

/** All active giveaways whose end time is at or before `now`. */
function dueGiveaways(now = Date.now()) {
  return Object.values(all()).filter(
    (g) => g && g.status === "active" && g.endsAt && new Date(g.endsAt).getTime() <= now
  );
}

/** All scheduled giveaways whose start time is at or before `now`. */
function dueToStart(now = Date.now()) {
  return Object.values(all()).filter(
    (g) => g && g.status === "scheduled" && g.startsAt && new Date(g.startsAt).getTime() <= now
  );
}

module.exports = { get, save, remove, forGuild, activeForGuild, dueGiveaways, dueToStart, all };

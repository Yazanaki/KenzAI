// modules/discord/giveaways/scheduling/scheduleStore.js
// CRUD over the `discord_giveaway_schedules` store. Each record:
//   { scheduleId, guildId, channelId, templateName, intervalMs, nextRunAt,
//     enabled, hostId, lastRunAt, createdAt }

const { stores } = require("../../../database/stores");
const { genId } = require("../../common/util");

const store = () => stores.discord_giveaway_schedules;

function all() {
  return store().readMap();
}

function get(scheduleId) {
  return all()[scheduleId] || null;
}

function save(record) {
  const map = all();
  map[record.scheduleId] = record;
  store().writeMap(map);
  return record;
}

function create(data) {
  const record = {
    scheduleId: genId("gws"),
    enabled: true,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    ...data,
  };
  return save(record);
}

function remove(scheduleId) {
  const map = all();
  const rec = map[scheduleId] || null;
  if (rec) {
    delete map[scheduleId];
    store().writeMap(map);
  }
  return rec;
}

function forGuild(guildId) {
  return Object.values(all()).filter((r) => r && r.guildId === guildId);
}

/** Enabled schedules whose next run time is at or before `now`. */
function dueSchedules(now = Date.now()) {
  return Object.values(all()).filter(
    (r) => r && r.enabled && r.nextRunAt && new Date(r.nextRunAt).getTime() <= now
  );
}

module.exports = { get, save, create, remove, forGuild, dueSchedules, all };

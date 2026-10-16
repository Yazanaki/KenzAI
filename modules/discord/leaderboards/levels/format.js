// modules/discord/leaderboards/levels/format.js
// Renders a single leaderboard line for the XP/level metric.
const levelStore = require("../../levels/levelStore");

module.exports = function formatLine(record, position) {
  const info = levelStore.levelFromXp(record.xp || 0);
  return `**#${position}** <@${record.userId}> — Level **${info.level}** • ${record.xp || 0} XP`;
};

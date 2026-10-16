// modules/discord/leaderboards/messages/format.js
// Renders a single leaderboard line for the message-count metric.
module.exports = function formatLine(record, position) {
  return `**#${position}** <@${record.userId}> — **${record.messages || 0}** messages`;
};

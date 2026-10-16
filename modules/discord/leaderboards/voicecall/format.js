// modules/discord/leaderboards/voicecall/format.js
// Renders a single leaderboard line for the voice-time metric.
module.exports = function formatLine(record, position) {
  const minutes = Math.floor((record.voiceSeconds || 0) / 60);
  const hours = Math.floor(minutes / 60);
  const label = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  return `**#${position}** <@${record.userId}> — **${label}** in voice`;
};

// modules/discord/moderation/modlog.js
// Mod-log dispatch + best-effort DM to the actioned user.

const { getGuildSettings } = require("../settings/settingsStore");
const { makeEmbed } = require("../common/embeds");

const ACTION_META = {
  warn: { emoji: "⚠️", color: "warn", past: "warned" },
  mute: { emoji: "🔇", color: "warn", past: "muted" },
  unmute: { emoji: "🔊", color: "success", past: "unmuted" },
  kick: { emoji: "👢", color: "danger", past: "kicked" },
  ban: { emoji: "🔨", color: "danger", past: "banned" },
  softban: { emoji: "🧹", color: "danger", past: "soft-banned" },
  unban: { emoji: "♻️", color: "success", past: "unbanned" },
  automod: { emoji: "🤖", color: "warn", past: "flagged" },
};

/** Build the standard moderation log embed for a case. */
function caseEmbed(guild, record, targetTag) {
  const meta = ACTION_META[record.action] || { emoji: "📝", color: "neutral" };
  const fields = [
    { name: "User", value: `<@${record.userId}> (${targetTag || record.userId})`, inline: true },
    { name: "Moderator", value: `<@${record.moderatorId}>`, inline: true },
    { name: "Reason", value: record.reason || "No reason provided", inline: false },
  ];
  if (record.durationMs) {
    const { formatDuration } = require("../common/util");
    fields.splice(2, 0, { name: "Duration", value: formatDuration(record.durationMs), inline: true });
  }
  return makeEmbed({
    color: meta.color,
    title: `${meta.emoji} ${record.action.toUpperCase()} — Case #${record.caseNumber}`,
    fields,
    footer: `User ID: ${record.userId}`,
    timestamp: true,
  });
}

/**
 * Post an embed to the guild's mod-log channel (best effort). When `action` is
 * given and a per-action channel is configured (moderation.logs[action]), that
 * channel is used; otherwise it falls back to moderation.modLogChannelId.
 */
async function sendModLog(guild, embed, action = null) {
  try {
    const mod = getGuildSettings(guild.id).moderation;
    const channelId = (action && mod.logs && mod.logs[action]) || mod.modLogChannelId;
    if (!channelId) return false;
    const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased()) return false;
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error("[discord/modlog] ❌ sendModLog:", err.message);
    return false;
  }
}

/** DM a user a notice about a moderation action (best effort, respects setting). */
async function dmActioned(guild, user, record) {
  try {
    if (!getGuildSettings(guild.id).moderation.dmOnAction) return false;
    const meta = ACTION_META[record.action] || {};
    const { formatDuration } = require("../common/util");
    const lines = [`You have been **${meta.past || record.action}** in **${guild.name}**.`];
    const fields = [{ name: "Reason", value: record.reason || "No reason provided" }];
    if (record.durationMs) fields.push({ name: "Duration", value: formatDuration(record.durationMs) });
    const embed = makeEmbed({
      color: meta.color || "warn",
      title: `${meta.emoji || "📝"} ${record.action.toUpperCase()} — ${guild.name}`,
      description: lines.join("\n"),
      fields,
      timestamp: true,
    });
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false; // user has DMs closed or shares no guild — ignore
  }
}

module.exports = { caseEmbed, sendModLog, dmActioned, ACTION_META };

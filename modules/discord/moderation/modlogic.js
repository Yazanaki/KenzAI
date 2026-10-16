// modules/discord/moderation/modlogic.js
// Orchestrates a moderation action: record the infraction, DM the target
// (before any destructive action so the DM can still be delivered), perform the
// Discord action, and post to the mod-log. Commands supply a `perform` callback
// for actions that touch Discord (ban/kick/timeout); warn omits it.

const infractions = require("./infractionsStore");
const modlog = require("./modlog");
const { makeEmbed } = require("../common/embeds");
const { formatDuration } = require("../common/util");

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {Object} opts
 * @param {string} opts.action        warn|mute|unmute|kick|ban|softban|unban
 * @param {import('discord.js').User} opts.targetUser
 * @param {string} [opts.reason]
 * @param {number} [opts.durationMs]
 * @param {Function} [opts.perform]   async () => void  (the Discord action)
 * @returns {Promise<Object>} the persisted infraction record
 */
async function punish(interaction, opts) {
  const guild = interaction.guild;
  const { action, targetUser, reason, durationMs, perform } = opts;

  const record = infractions.create({
    guildId: guild.id,
    userId: targetUser.id,
    moderatorId: interaction.user.id,
    action,
    reason,
    durationMs: durationMs || null,
    expiresAt: durationMs ? new Date(Date.now() + durationMs).toISOString() : null,
  });

  // DM first — after a ban/kick the user may no longer be reachable.
  await modlog.dmActioned(guild, targetUser, record);

  try {
    if (perform) await perform();
  } catch (err) {
    infractions.remove(record.caseId); // roll back the record if the action failed
    throw err;
  }

  await modlog.sendModLog(guild, modlog.caseEmbed(guild, record, targetUser.tag), record.action);
  return record;
}

/** Embed shown back to the moderator confirming the action. */
function confirmEmbed(record, targetUser) {
  const meta = modlog.ACTION_META[record.action] || { emoji: "📝", color: "neutral" };
  const parts = [`${meta.emoji} **${targetUser.tag}** was **${meta.past || record.action}**.`];
  if (record.durationMs) parts.push(`Duration: **${formatDuration(record.durationMs)}**`);
  parts.push(`Reason: ${record.reason}`);
  return makeEmbed({
    color: meta.color,
    description: parts.join("\n"),
    footer: `Case #${record.caseNumber}`,
  });
}

module.exports = { punish, confirmEmbed, infractions, modlog };

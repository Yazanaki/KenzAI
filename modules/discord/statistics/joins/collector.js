// modules/discord/statistics/joins/collector.js
// Counts member joins and posts a join log.
const statsStore = require("../statsStore");
const { getGuildSettings } = require("../../settings/settingsStore");
const { makeEmbed } = require("../../common/embeds");

async function handleJoin(member) {
  try {
    const stats = getGuildSettings(member.guild.id).statistics;
    if (!stats.enabled) return;
    statsStore.recordJoin(member.guild.id);

    const chId = stats.logs.joinLeaveChannelId;
    if (!chId) return;
    const ch = member.guild.channels.cache.get(chId);
    if (!ch?.isTextBased()) return;

    const created = Math.floor(member.user.createdTimestamp / 1000);
    await ch
      .send({
        embeds: [
          makeEmbed({
            color: "success",
            description: `📥 <@${member.id}> (${member.user.tag}) joined.`,
            thumbnail: member.user.displayAvatarURL(),
            fields: [{ name: "Account created", value: `<t:${created}:R>`, inline: true }],
            footer: `ID: ${member.id}`,
            timestamp: true,
          }),
        ],
      })
      .catch(() => {});
  } catch (err) {
    console.error("[discord/stats] ❌ join:", err.message);
  }
}

module.exports = { handleJoin };

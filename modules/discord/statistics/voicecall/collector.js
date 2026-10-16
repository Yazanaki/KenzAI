// modules/discord/statistics/voicecall/collector.js
// Logs voice join/leave/move events and accrues total voice-seconds (buffered).
const statsStore = require("../statsStore");
const { getGuildSettings } = require("../../settings/settingsStore");
const { makeEmbed } = require("../../common/embeds");

const starts = new Map(); // `${guildId}:${userId}` -> session start ts

async function handleVoiceState(oldState, newState) {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    const guild = newState.guild;
    if (!getGuildSettings(guild.id).statistics.enabled) return;

    const key = `${guild.id}:${member.id}`;
    const wasIn = oldState.channelId;
    const isIn = newState.channelId;
    const now = Date.now();

    // Settle accrued time when leaving or switching channels.
    if (wasIn && (!isIn || wasIn !== isIn)) {
      const start = starts.get(key);
      if (start) statsStore.recordVoiceSeconds(guild.id, Math.floor((now - start) / 1000));
      starts.delete(key);
    }
    if (isIn && (!wasIn || wasIn !== isIn)) starts.set(key, now);

    // Logging
    const chId = getGuildSettings(guild.id).statistics.logs.voiceChannelId;
    if (!chId) return;
    const ch = guild.channels.cache.get(chId);
    if (!ch?.isTextBased()) return;

    let desc;
    if (!wasIn && isIn) desc = `🔊 **${member.user.tag}** joined <#${isIn}>`;
    else if (wasIn && !isIn) desc = `🔈 **${member.user.tag}** left <#${wasIn}>`;
    else if (wasIn !== isIn) desc = `🔀 **${member.user.tag}** moved <#${wasIn}> → <#${isIn}>`;
    else return; // mute/deafen state change — not logged

    await ch.send({ embeds: [makeEmbed({ color: "info", description: desc, footer: `ID: ${member.id}`, timestamp: true })] }).catch(() => {});
  } catch (err) {
    console.error("[discord/stats] ❌ voice:", err.message);
  }
}

module.exports = { handleVoiceState };

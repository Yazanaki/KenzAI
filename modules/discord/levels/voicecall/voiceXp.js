// modules/discord/levels/voicecall/voiceXp.js
// Voice-activity XP. Tracks active voice sessions in memory and flushes accrued
// time both on state changes and on a periodic tick (so long calls award XP and
// level-ups without waiting for the member to leave). Farming guards: ignores
// AFK channel / self-muted members (unless configured) and members alone in a
// channel.

const { getGuildSettings } = require("../../settings/settingsStore");
const levelStore = require("../levelStore");
const { applyRewards } = require("../rewards/roleRewards");

const DEFAULT_TICK_SECONDS = 60;
const sessions = new Map(); // `${guildId}:${userId}` -> lastFlushTs
let intervalTimer = null;
let started = false;

function tickMs() {
  const s = parseFloat(process.env.DISCORD_VOICE_TICK_SECONDS);
  return (Number.isFinite(s) && s > 0 ? s : DEFAULT_TICK_SECONDS) * 1000;
}

function eligible(voiceState, lv) {
  if (!voiceState || !voiceState.channelId) return false;
  const channel = voiceState.channel;
  if (!channel) return false;
  if (channel.id === voiceState.guild.afkChannelId && !lv.countAfkChannel) return false;
  const muted = voiceState.selfMute || voiceState.selfDeaf || voiceState.serverMute || voiceState.serverDeaf;
  if (muted && !lv.countMutedVoice) return false;
  const humans = channel.members.filter((m) => !m.user.bot).size;
  if (humans < 2) return false;
  return true;
}

async function announceLevelUp(guild, member, level, lv) {
  if (!lv.announceLevelUp) return;
  const text = (lv.levelUpMessage || "GG {user}, level {level}!")
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{level\}/g, String(level));
  const target = lv.announceTarget || "current";
  try {
    if (target === "dm") await member.send(text.replace(`<@${member.id}>`, "You")).catch(() => {});
    else if (target !== "current") {
      const ch = guild.channels.cache.get(target);
      if (ch?.isTextBased()) await ch.send({ content: text, allowedMentions: { users: [member.id] } }).catch(() => {});
    }
    // "current" has no text-channel context for voice — skipped intentionally.
  } catch {
    /* ignore */
  }
}

async function flush(guild, member) {
  const key = `${guild.id}:${member.id}`;
  const last = sessions.get(key);
  if (!last) return;
  const now = Date.now();
  const seconds = Math.floor((now - last) / 1000);
  sessions.set(key, now);
  if (seconds <= 0) return;

  const lv = getGuildSettings(guild.id).leveling;
  if (!lv.enabled) return;
  if (!eligible(member.voice, lv)) return;

  const xp = Math.round((seconds / 60) * (lv.voiceXpPerMinute || 5));
  const res = levelStore.addXp(guild.id, member.id, xp, { incVoiceSeconds: seconds });
  if (res.leveledUp) {
    await announceLevelUp(guild, member, res.newLevel, lv);
    await applyRewards(member, res.newLevel, lv);
  }
}

async function handleVoiceState(oldState, newState) {
  try {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    const guild = newState.guild;
    const key = `${guild.id}:${member.id}`;

    const wasIn = !!oldState.channelId;
    const isIn = !!newState.channelId;

    if (wasIn) await flush(guild, member); // settle accrued time before transition

    if (isIn) sessions.set(key, Date.now());
    else sessions.delete(key);
  } catch (err) {
    console.error("[discord/levels] ❌ voice state:", err.message);
  }
}

function startVoiceScheduler(client) {
  if (started) return;
  started = true;
  intervalTimer = setInterval(async () => {
    for (const key of [...sessions.keys()]) {
      const [guildId, userId] = key.split(":");
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        sessions.delete(key);
        continue;
      }
      const member = guild.members.cache.get(userId);
      if (!member || !member.voice?.channelId) {
        sessions.delete(key);
        continue;
      }
      await flush(guild, member).catch(() => {});
    }
  }, tickMs());
  console.log(`[discord/levels] 🎙️ Voice XP scheduler started (every ${Math.round(tickMs() / 1000)}s)`);
}

function stopVoiceScheduler() {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
  started = false;
}

module.exports = { handleVoiceState, startVoiceScheduler, stopVoiceScheduler };

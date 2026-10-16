// modules/discord/levels/messages/xp.js
// Grants message XP on messageCreate (per-user cooldown, channel/role
// exclusions, role multipliers), announces level-ups, and applies role rewards.
// Cooldown state is in-memory to avoid a disk write on every message.

const { getGuildSettings } = require("../../settings/settingsStore");
const levelStore = require("../levelStore");
const { applyRewards } = require("../rewards/roleRewards");
const { randInt } = require("../../common/util");

const cooldowns = new Map(); // `${guildId}:${userId}` -> last-award timestamp

function highestMultiplier(member, multiplierRoles) {
  if (!member || !multiplierRoles) return 1;
  let mult = 1;
  for (const [roleId, factor] of Object.entries(multiplierRoles)) {
    if (member.roles.cache.has(roleId)) mult = Math.max(mult, Number(factor) || 1);
  }
  return mult;
}

async function announce(message, level, lv, member) {
  if (!lv.announceLevelUp) return;
  const text = (lv.levelUpMessage || "GG {user}, level {level}!")
    .replace(/\{user\}/g, `<@${member.id}>`)
    .replace(/\{level\}/g, String(level));

  const target = lv.announceTarget || "current";
  try {
    if (target === "dm") {
      await member.send(text.replace(`<@${member.id}>`, "You")).catch(() => {});
    } else if (target === "current") {
      await message.channel.send({ content: text, allowedMentions: { users: [member.id] } }).catch(() => {});
    } else {
      const ch = message.guild.channels.cache.get(target);
      if (ch?.isTextBased()) await ch.send({ content: text, allowedMentions: { users: [member.id] } }).catch(() => {});
    }
  } catch {
    /* ignore announce failures */
  }
}

async function handleMessage(message) {
  try {
    if (!message.guild || message.author?.bot || message.system) return;
    const lv = getGuildSettings(message.guild.id).leveling;
    if (!lv.enabled) return;
    if (lv.noXpChannelIds?.includes(message.channel.id)) return;

    const member = message.member;
    if (member && lv.noXpRoleIds?.some((r) => member.roles.cache.has(r))) return;

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const last = cooldowns.get(key) || 0;
    if (now - last < (lv.messageCooldownSeconds || 60) * 1000) return;
    cooldowns.set(key, now);

    let xp = randInt(lv.xpPerMessageMin || 15, lv.xpPerMessageMax || 25);
    xp = Math.round(xp * highestMultiplier(member, lv.multiplierRoles));

    const res = levelStore.addXp(message.guild.id, message.author.id, xp, { incMessages: 1 });
    if (res.leveledUp && member) {
      await announce(message, res.newLevel, lv, member);
      await applyRewards(member, res.newLevel, lv);
    }
  } catch (err) {
    console.error("[discord/levels] ❌ message xp:", err.message);
  }
}

module.exports = { handleMessage };

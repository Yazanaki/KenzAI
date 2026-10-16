// modules/discord/moderation/automod/rules.js
// Automod evaluation for messageCreate + raid detection for guildMemberAdd.
// Rules are driven entirely by per-guild config (settings.automod). Staff
// (Manage Messages), exempt roles, and exempt channels bypass all rules.

const { getAutomod } = require("./automodStore");
const { getGuildSettings } = require("../../settings/settingsStore");
const { makeEmbed } = require("../../common/embeds");
const infractions = require("../infractionsStore");
const modlog = require("../modlog");
const { PermissionFlagsBits } = require("discord.js");

const INVITE_RE = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/\S+/i;

// In-memory spam trackers (reset on restart — fine for rate windows).
const spamHits = new Map(); // key `${guild}:${user}` -> number[] timestamps
const raidJoins = new Map(); // guildId -> number[] join timestamps

function isExempt(message, automod) {
  const member = message.member;
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  if (automod.exemptChannelIds?.includes(message.channel.id)) return true;
  if (automod.exemptRoleIds?.some((rid) => member.roles.cache.has(rid))) return true;
  return false;
}

function capsRatio(text) {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (!letters.length) return 0;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return (upper / letters.length) * 100;
}

/** Evaluate all enabled rules against a message. Returns a violation or null. */
function evaluate(message, automod) {
  const content = message.content || "";

  if (automod.antiInvite?.enabled && INVITE_RE.test(content)) {
    return { rule: "Invite link", action: automod.antiInvite.action };
  }

  if (automod.wordFilter?.enabled && Array.isArray(automod.wordFilter.words) && automod.wordFilter.words.length) {
    const lower = content.toLowerCase();
    const hit = automod.wordFilter.words.find((w) => w && lower.includes(String(w).toLowerCase()));
    if (hit) return { rule: "Blocked word", action: automod.wordFilter.action };
  }

  if (automod.antiMention?.enabled) {
    const mentions = (message.mentions?.users?.size || 0) + (message.mentions?.roles?.size || 0);
    if (mentions > automod.antiMention.maxMentions)
      return { rule: `Mention spam (${mentions})`, action: automod.antiMention.action, muteSeconds: automod.antiMention.muteSeconds };
  }

  if (automod.antiCaps?.enabled && content.length >= automod.antiCaps.minLength) {
    if (capsRatio(content) >= automod.antiCaps.percent)
      return { rule: "Excessive caps", action: automod.antiCaps.action };
  }

  if (automod.antiSpam?.enabled) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const arr = (spamHits.get(key) || []).filter((t) => now - t < automod.antiSpam.intervalMs);
    arr.push(now);
    spamHits.set(key, arr);
    if (arr.length > automod.antiSpam.maxMessages) {
      spamHits.set(key, []); // reset after triggering
      return { rule: `Spam (${arr.length} msgs)`, action: automod.antiSpam.action, muteSeconds: automod.antiSpam.muteSeconds };
    }
  }

  return null;
}

async function applyAction(message, violation) {
  const guild = message.guild;
  const action = violation.action || "delete";
  const reason = `[automod] ${violation.rule}`;

  // Always try to delete the offending message (except for warn-only setups it
  // still makes sense to remove the content).
  try {
    await message.delete();
  } catch {
    /* message may already be gone */
  }

  if ((action === "mute" || action === "warn") && message.member) {
    if (action === "mute" && message.member.moderatable) {
      const ms = (violation.muteSeconds || 300) * 1000;
      await message.member.timeout(ms, reason).catch(() => {});
      infractions.create({
        guildId: guild.id,
        userId: message.author.id,
        moderatorId: guild.members.me?.id,
        action: "mute",
        reason,
        durationMs: ms,
      });
    } else {
      infractions.create({
        guildId: guild.id,
        userId: message.author.id,
        moderatorId: guild.members.me?.id,
        action: "warn",
        reason,
      });
    }
  }

  // Log to automod log channel (falls back to mod-log channel).
  const automod = getAutomod(guild.id);
  const embed = makeEmbed({
    color: "warn",
    title: "🤖 Automod",
    description: `Action **${action}** taken against <@${message.author.id}> in <#${message.channel.id}>.`,
    fields: [
      { name: "Rule", value: violation.rule, inline: true },
      { name: "User", value: `${message.author.tag}`, inline: true },
    ],
    footer: `User ID: ${message.author.id}`,
    timestamp: true,
  });
  const logId = automod.logChannelId;
  if (logId) {
    const ch = guild.channels.cache.get(logId);
    if (ch?.isTextBased()) await ch.send({ embeds: [embed] }).catch(() => {});
  } else {
    await modlog.sendModLog(guild, embed);
  }
}

/** messageCreate entry point. */
async function handleMessage(message) {
  try {
    if (!message.guild || message.author?.bot || message.system) return;
    const automod = getAutomod(message.guild.id);
    if (!automod.enabled) return;
    if (isExempt(message, automod)) return;
    const violation = evaluate(message, automod);
    if (violation) await applyAction(message, violation);
  } catch (err) {
    console.error("[discord/automod] ❌ handleMessage:", err.message);
  }
}

/** guildMemberAdd entry point — raid detection. */
async function handleJoin(member) {
  try {
    const guild = member.guild;
    const automod = getAutomod(guild.id);
    if (!automod.enabled || !automod.antiRaid?.enabled) return;

    const now = Date.now();
    const arr = (raidJoins.get(guild.id) || []).filter((t) => now - t < automod.antiRaid.intervalMs);
    arr.push(now);
    raidJoins.set(guild.id, arr);

    if (arr.length < automod.antiRaid.joinCount) return;

    // Raid threshold reached — act on the joining member per configured action.
    const action = automod.antiRaid.action;
    const reason = "[automod] Raid protection";
    if (action === "kick" && member.kickable) await member.kick(reason).catch(() => {});
    else if (action === "ban" && member.bannable) await member.ban({ reason }).catch(() => {});

    const embed = makeEmbed({
      color: "danger",
      title: "🚨 Automod — possible raid",
      description: `Detected **${arr.length}** joins within ${Math.round(automod.antiRaid.intervalMs / 1000)}s. Action on new joiners: **${action}**.`,
      timestamp: true,
    });
    const ch = automod.logChannelId && guild.channels.cache.get(automod.logChannelId);
    if (ch?.isTextBased()) await ch.send({ embeds: [embed] }).catch(() => {});
    else await modlog.sendModLog(guild, embed);
  } catch (err) {
    console.error("[discord/automod] ❌ handleJoin:", err.message);
  }
}

module.exports = { handleMessage, handleJoin, INVITE_RE };

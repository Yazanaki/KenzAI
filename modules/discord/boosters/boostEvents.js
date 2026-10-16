// modules/discord/boosters/boostEvents.js
// Booster lifecycle:
//  • guildMemberUpdate — remove the self-service role on unboost (if configured)
//    and reset the multi-boost count / role.
//  • messageCreate (GuildBoost system messages) — count each boost a member
//    applies and grant the per-server multi-booster role at the threshold.
//
// NOTE: Discord exposes no per-member boost count, so counts are derived from
// GuildBoost system messages observed while the bot is running. Historical
// boosts (before the bot saw them) aren't counted — admins can seed counts with
// /boostrole setcount.

const { MessageType, PermissionFlagsBits } = require("discord.js");
const { getGuildSettings } = require("../settings/settingsStore");
const boostStore = require("./boostRoleStore");
const boostCounts = require("./boostCountStore");
const { makeEmbed } = require("../common/embeds");

// A member applying a boost produces one of these system messages (the tier
// variants fire when that boost also reaches a new server level).
const BOOST_MESSAGE_TYPES = new Set([
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3,
]);

async function log(guild, settings, embed) {
  if (!settings.logChannelId) return;
  const ch = guild.channels.cache.get(settings.logChannelId);
  if (ch?.isTextBased()) await ch.send({ embeds: [embed] }).catch(() => {});
}

/** Add/remove the multi-booster role based on the member's tracked boost count. */
async function reconcileMultiBoost(guild, userId, settings) {
  const roleId = settings.multiBoostRoleId;
  if (!roleId) return;
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return;
  const role = guild.roles.cache.get(roleId);
  if (!role || role.position >= me.roles.highest.position) return;

  const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
  if (!member) return;

  const count = boostCounts.getCount(guild.id, userId);
  const qualifies = count >= (settings.multiBoostThreshold || 2);
  const has = member.roles.cache.has(roleId);
  if (qualifies && !has) {
    await member.roles.add(roleId, `Multi-booster (${count} boosts)`).catch(() => {});
    await log(guild, settings, makeEmbed({ color: "success", description: `💎 <@${userId}> is now a multi-booster (**${count}** boosts) — granted ${role}.` }));
  } else if (!qualifies && has) {
    await member.roles.remove(roleId, "No longer meets multi-boost threshold").catch(() => {});
  }
}

async function handleGuildMemberUpdate(oldMember, newMember) {
  try {
    if (oldMember.partial) await oldMember.fetch().catch(() => {});
    const guild = newMember.guild;
    const settings = getGuildSettings(guild.id).boosterRoles;

    const was = oldMember.premiumSinceTimestamp;
    const now = newMember.premiumSinceTimestamp;

    // Stopped boosting.
    if (was && !now) {
      // Self-service role cleanup.
      if (settings.enabled && settings.removeOnUnboost) {
        const rec = boostStore.get(guild.id, newMember.id);
        if (rec) {
          const role = guild.roles.cache.get(rec.roleId);
          if (role) await role.delete("Member stopped boosting").catch(() => {});
          boostStore.remove(guild.id, newMember.id);
          await log(guild, settings, makeEmbed({ color: "warn", description: `💔 <@${newMember.id}> stopped boosting — their booster role was removed.` }));
        }
      }
      // Multi-boost reset: they no longer boost at all.
      boostCounts.remove(guild.id, newMember.id);
      await reconcileMultiBoost(guild, newMember.id, settings);
    }
    // Started boosting.
    else if (!was && now) {
      if (settings.enabled)
        await log(guild, settings, makeEmbed({ color: "success", description: `💜 <@${newMember.id}> started boosting! They can now use \`/boostrole create\`.` }));
    }
  } catch (err) {
    console.error("[discord/boosters] ❌ member update:", err.message);
  }
}

/** Count GuildBoost system messages and reconcile the multi-booster role. */
async function handleBoostMessage(message) {
  try {
    if (!message.guild || !BOOST_MESSAGE_TYPES.has(message.type)) return;
    const userId = message.author?.id;
    if (!userId) return;
    const settings = getGuildSettings(message.guild.id).boosterRoles;
    const count = boostCounts.increment(message.guild.id, userId, 1);
    if (settings.multiBoostRoleId) {
      await reconcileMultiBoost(message.guild, userId, settings);
    } else {
      // Still record the boost so a later-configured role can catch up.
      void count;
    }
  } catch (err) {
    console.error("[discord/boosters] ❌ boost message:", err.message);
  }
}

module.exports = { handleGuildMemberUpdate, handleBoostMessage, reconcileMultiBoost };

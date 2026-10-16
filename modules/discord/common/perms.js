// modules/discord/common/perms.js
// Permission + role-hierarchy checks shared across moderation commands.

const { PermissionFlagsBits } = require("discord.js");

function has(member, flag) {
  try {
    return !!member && member.permissions?.has(flag);
  } catch {
    return false;
  }
}

const canModerateMembers = (m) => has(m, PermissionFlagsBits.ModerateMembers);
const canKick = (m) => has(m, PermissionFlagsBits.KickMembers);
const canBan = (m) => has(m, PermissionFlagsBits.BanMembers);
const canManageMessages = (m) => has(m, PermissionFlagsBits.ManageMessages);
const canManageGuild = (m) => has(m, PermissionFlagsBits.ManageGuild);
const canManageRoles = (m) => has(m, PermissionFlagsBits.ManageRoles);
const canManageChannels = (m) => has(m, PermissionFlagsBits.ManageChannels);

/**
 * Whether `moderator` may act on `target` in this guild. Blocks acting on
 * self, the guild owner, someone with an equal/higher top role, and (when the
 * bot member is provided) targets the bot itself can't touch.
 * @returns {{ ok: boolean, reason?: string }}
 */
function canActOn(moderator, target, botMember = null) {
  if (!target) return { ok: true };
  if (moderator && target.id === moderator.id)
    return { ok: false, reason: "You can't target yourself." };
  const guild = moderator?.guild || target.guild;
  if (guild && target.id === guild.ownerId)
    return { ok: false, reason: "You can't target the server owner." };

  // Moderator hierarchy (owner bypasses).
  if (moderator && guild && moderator.id !== guild.ownerId) {
    if (
      target.roles?.highest &&
      moderator.roles?.highest &&
      target.roles.highest.position >= moderator.roles.highest.position
    ) {
      return { ok: false, reason: "That member has an equal or higher role than you." };
    }
  }

  // Bot hierarchy — the bot must outrank the target to action them.
  if (botMember && target.roles?.highest && botMember.roles?.highest) {
    if (target.roles.highest.position >= botMember.roles.highest.position) {
      return { ok: false, reason: "My role isn't high enough to action that member." };
    }
  }
  return { ok: true };
}

module.exports = {
  canModerateMembers,
  canKick,
  canBan,
  canManageMessages,
  canManageGuild,
  canManageRoles,
  canManageChannels,
  canActOn,
};

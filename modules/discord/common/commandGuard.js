// modules/discord/common/commandGuard.js
// Per-guild "moderation roles" command-permission layer, configured in /setup.
//
// Model: settings.permissions.groups maps a group name -> [roleId]; settings.
// permissions.commandGroup maps a command name -> a group name. Authorization
// for a command's INVOKER:
//   • Manage Server / Administrator  -> always allowed.
//   • Command's group HAS roles configured -> allowed iff the member holds one
//     of them (this GRANTS access — e.g. a "Trial Mod" role can use /warn even
//     without Discord's Moderate Members permission, and denies everyone else).
//   • Command's group is unconfigured (no mapping or no roles) -> fall back to
//     the command's built-in Discord permission check.
//
// This only governs the INVOKER's authorization. Target/bot-hierarchy checks
// (canActOn, member.bannable, etc.) are independent and always still run.

const { PermissionFlagsBits } = require("discord.js");
const { getGuildSettings } = require("../settings/settingsStore");
const { danger } = require("./embeds");

/**
 * @param member          the invoking GuildMember
 * @param commandName     e.g. "warn"
 * @param builtinCheck    (member) => boolean — the command's default Discord
 *                        permission check, used when no role group is configured
 * @param settings        optional pre-read guild settings
 */
function canUse(member, commandName, builtinCheck = () => false, settings = null) {
  if (!member) return false;
  if (
    member.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions?.has(PermissionFlagsBits.Administrator)
  ) {
    return true;
  }
  const perms = (settings || getGuildSettings(member.guild.id)).permissions || {};
  const group = perms.commandGroup?.[commandName];
  const roleIds = (group && perms.groups?.[group]) || [];
  if (roleIds.length) return roleIds.some((rid) => member.roles.cache.has(rid));
  return !!builtinCheck(member); // unconfigured — defer to built-in Discord check
}

/**
 * Enforce authorization at the top of a command. Returns true if allowed; if
 * denied, replies ephemerally and returns false.
 */
async function authorize(interaction, commandName, builtinCheck = () => false) {
  if (canUse(interaction.member, commandName, builtinCheck)) return true;
  const perms = getGuildSettings(interaction.guildId).permissions || {};
  const group = perms.commandGroup?.[commandName];
  const roleIds = (group && perms.groups?.[group]) || [];
  const need = roleIds.length ? roleIds.map((r) => `<@&${r}>`).join(", ") : "the required permission";
  await interaction
    .reply({ embeds: [danger(`You don't have permission to use \`/${commandName}\`. Requires ${need}.`)], ephemeral: true })
    .catch(() => {});
  return false;
}

module.exports = { canUse, authorize };

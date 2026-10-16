// modules/discord/moderation/muting/mute.js — /mute (Discord timeout)
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { canModerateMembers, canActOn } = require("../../common/perms");
const { authorize } = require("../../common/commandGuard");
const { punish, confirmEmbed } = require("../modlogic");
const { danger } = require("../../common/embeds");
const { parseDuration } = require("../../common/util");

const MAX_TIMEOUT_MS = 28 * 86400 * 1000; // Discord hard limit

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Timeout (mute) a member for a duration")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Member to mute").setRequired(true))
    .addStringOption((o) => o.setName("duration").setDescription("e.g. 10m, 2h, 1d (max 28d)").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the mute")),

  async execute(interaction) {
    if (!(await authorize(interaction, "mute", canModerateMembers))) return;

    const target = interaction.options.getUser("user");
    const member = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const durationMs = parseDuration(interaction.options.getString("duration"));

    if (!durationMs)
      return interaction.reply({ embeds: [danger("Invalid duration. Try `10m`, `2h`, `1d`.")], ephemeral: true });
    if (durationMs > MAX_TIMEOUT_MS)
      return interaction.reply({ embeds: [danger("Timeouts can be at most **28 days**.")], ephemeral: true });
    if (!member)
      return interaction.reply({ embeds: [danger("That user isn't in this server.")], ephemeral: true });
    if (!member.moderatable)
      return interaction.reply({ embeds: [danger("I can't time out that member (check my role position and permissions).")], ephemeral: true });

    const check = canActOn(interaction.member, member, interaction.guild.members.me);
    if (!check.ok) return interaction.reply({ embeds: [danger(check.reason)], ephemeral: true });

    try {
      const record = await punish(interaction, {
        action: "mute",
        targetUser: target,
        reason,
        durationMs,
        perform: () => member.timeout(durationMs, `${reason} — by ${interaction.user.tag}`),
      });
      return interaction.reply({ embeds: [confirmEmbed(record, target)] });
    } catch (err) {
      return interaction.reply({ embeds: [danger(`Failed to mute: ${err.message}`)], ephemeral: true });
    }
  },
};

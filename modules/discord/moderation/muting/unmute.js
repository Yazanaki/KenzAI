// modules/discord/moderation/muting/unmute.js — /unmute (clear timeout)
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { canModerateMembers, canActOn } = require("../../common/perms");
const { authorize } = require("../../common/commandGuard");
const { punish, confirmEmbed } = require("../modlogic");
const { danger } = require("../../common/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove a member's timeout (unmute)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Member to unmute").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),

  async execute(interaction) {
    if (!(await authorize(interaction, "unmute", canModerateMembers))) return;

    const target = interaction.options.getUser("user");
    const member = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason provided";

    if (!member)
      return interaction.reply({ embeds: [danger("That user isn't in this server.")], ephemeral: true });
    if (!member.isCommunicationDisabled())
      return interaction.reply({ embeds: [danger("That member isn't muted.")], ephemeral: true });
    if (!member.moderatable)
      return interaction.reply({ embeds: [danger("I can't unmute that member (check my role position and permissions).")], ephemeral: true });

    const check = canActOn(interaction.member, member, interaction.guild.members.me);
    if (!check.ok) return interaction.reply({ embeds: [danger(check.reason)], ephemeral: true });

    try {
      const record = await punish(interaction, {
        action: "unmute",
        targetUser: target,
        reason,
        perform: () => member.timeout(null, `${reason} — by ${interaction.user.tag}`),
      });
      return interaction.reply({ embeds: [confirmEmbed(record, target)] });
    } catch (err) {
      return interaction.reply({ embeds: [danger(`Failed to unmute: ${err.message}`)], ephemeral: true });
    }
  },
};

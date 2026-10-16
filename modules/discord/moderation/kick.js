// modules/discord/moderation/kick.js — /kick
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { canKick, canActOn } = require("../common/perms");
const { authorize } = require("../common/commandGuard");
const { punish, confirmEmbed } = require("./modlogic");
const { danger } = require("../common/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from the server")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Member to kick").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the kick")),

  async execute(interaction) {
    if (!(await authorize(interaction, "kick", canKick))) return;

    const target = interaction.options.getUser("user");
    const member = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason provided";

    if (!member)
      return interaction.reply({ embeds: [danger("That user isn't in this server.")], ephemeral: true });
    if (!member.kickable)
      return interaction.reply({ embeds: [danger("I can't kick that member (check my role position and permissions).")], ephemeral: true });

    const check = canActOn(interaction.member, member, interaction.guild.members.me);
    if (!check.ok) return interaction.reply({ embeds: [danger(check.reason)], ephemeral: true });

    try {
      const record = await punish(interaction, {
        action: "kick",
        targetUser: target,
        reason,
        perform: () => member.kick(`${reason} — by ${interaction.user.tag}`),
      });
      return interaction.reply({ embeds: [confirmEmbed(record, target)] });
    } catch (err) {
      return interaction.reply({ embeds: [danger(`Failed to kick: ${err.message}`)], ephemeral: true });
    }
  },
};

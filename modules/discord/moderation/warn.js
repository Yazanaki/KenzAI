// modules/discord/moderation/warn.js — /warn
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { canModerateMembers, canActOn } = require("../common/perms");
const { authorize } = require("../common/commandGuard");
const { punish, confirmEmbed } = require("./modlogic");
const { danger } = require("../common/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member and log the infraction")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Member to warn").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the warning")),

  async execute(interaction) {
    if (!(await authorize(interaction, "warn", canModerateMembers))) return;

    const target = interaction.options.getUser("user");
    const member = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason provided";

    if (member) {
      const check = canActOn(interaction.member, member, interaction.guild.members.me);
      if (!check.ok) return interaction.reply({ embeds: [danger(check.reason)], ephemeral: true });
    }

    const record = await punish(interaction, { action: "warn", targetUser: target, reason });
    return interaction.reply({ embeds: [confirmEmbed(record, target)] });
  },
};

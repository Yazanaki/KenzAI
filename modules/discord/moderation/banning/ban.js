// modules/discord/moderation/banning/ban.js — /ban
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { canBan, canActOn } = require("../../common/perms");
const { authorize } = require("../../common/commandGuard");
const { punish, confirmEmbed } = require("../modlogic");
const { danger } = require("../../common/embeds");
const { clamp } = require("../../common/util");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member (or user ID) from the server")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Member/user to ban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the ban"))
    .addIntegerOption((o) =>
      o
        .setName("delete-days")
        .setDescription("Days of the user's recent messages to delete (0-7)")
        .setMinValue(0)
        .setMaxValue(7)
    ),

  async execute(interaction) {
    if (!(await authorize(interaction, "ban", canBan))) return;

    const target = interaction.options.getUser("user");
    const member = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const deleteDays = clamp(interaction.options.getInteger("delete-days") ?? 0, 0, 7);

    if (member) {
      if (!member.bannable)
        return interaction.reply({ embeds: [danger("I can't ban that member (check my role position and permissions).")], ephemeral: true });
      const check = canActOn(interaction.member, member, interaction.guild.members.me);
      if (!check.ok) return interaction.reply({ embeds: [danger(check.reason)], ephemeral: true });
    }

    try {
      const record = await punish(interaction, {
        action: "ban",
        targetUser: target,
        reason,
        perform: () =>
          interaction.guild.members.ban(target.id, {
            reason: `${reason} — by ${interaction.user.tag}`,
            deleteMessageSeconds: deleteDays * 86400,
          }),
      });
      return interaction.reply({ embeds: [confirmEmbed(record, target)] });
    } catch (err) {
      return interaction.reply({ embeds: [danger(`Failed to ban: ${err.message}`)], ephemeral: true });
    }
  },
};

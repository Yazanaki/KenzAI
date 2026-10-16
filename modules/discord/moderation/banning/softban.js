// modules/discord/moderation/banning/softban.js — /softban
// Ban then immediately unban: kicks the member and purges their recent
// messages without a lasting ban entry.
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { canBan, canActOn } = require("../../common/perms");
const { authorize } = require("../../common/commandGuard");
const { punish, confirmEmbed } = require("../modlogic");
const { danger } = require("../../common/embeds");
const { clamp } = require("../../common/util");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Ban then unban a member to purge their recent messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Member to soft-ban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason"))
    .addIntegerOption((o) =>
      o
        .setName("delete-days")
        .setDescription("Days of messages to delete (1-7, default 1)")
        .setMinValue(1)
        .setMaxValue(7)
    ),

  async execute(interaction) {
    if (!(await authorize(interaction, "softban", canBan))) return;

    const target = interaction.options.getUser("user");
    const member = interaction.options.getMember("user");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const deleteDays = clamp(interaction.options.getInteger("delete-days") ?? 1, 1, 7);

    if (!member)
      return interaction.reply({ embeds: [danger("That user isn't in this server.")], ephemeral: true });
    if (!member.bannable)
      return interaction.reply({ embeds: [danger("I can't ban that member (check my role position and permissions).")], ephemeral: true });
    const check = canActOn(interaction.member, member, interaction.guild.members.me);
    if (!check.ok) return interaction.reply({ embeds: [danger(check.reason)], ephemeral: true });

    try {
      const record = await punish(interaction, {
        action: "softban",
        targetUser: target,
        reason,
        perform: async () => {
          await interaction.guild.members.ban(target.id, {
            reason: `Softban: ${reason} — by ${interaction.user.tag}`,
            deleteMessageSeconds: deleteDays * 86400,
          });
          await interaction.guild.members.unban(target.id, "Softban — automatic unban");
        },
      });
      return interaction.reply({ embeds: [confirmEmbed(record, target)] });
    } catch (err) {
      return interaction.reply({ embeds: [danger(`Failed to soft-ban: ${err.message}`)], ephemeral: true });
    }
  },
};

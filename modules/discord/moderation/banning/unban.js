// modules/discord/moderation/banning/unban.js — /unban
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { canBan } = require("../../common/perms");
const { authorize } = require("../../common/commandGuard");
const { infractions, modlog } = require("../modlogic");
const { danger, success } = require("../../common/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user by their ID")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addStringOption((o) => o.setName("user-id").setDescription("The user ID to unban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the unban")),

  async execute(interaction) {
    if (!(await authorize(interaction, "unban", canBan))) return;

    const userId = interaction.options.getString("user-id").trim();
    const reason = interaction.options.getString("reason") || "No reason provided";

    if (!/^\d{16,20}$/.test(userId))
      return interaction.reply({ embeds: [danger("That doesn't look like a valid user ID.")], ephemeral: true });

    const existing = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!existing)
      return interaction.reply({ embeds: [danger("That user is not banned.")], ephemeral: true });

    try {
      await interaction.guild.members.unban(userId, `${reason} — by ${interaction.user.tag}`);
      const record = infractions.create({
        guildId: interaction.guild.id,
        userId,
        moderatorId: interaction.user.id,
        action: "unban",
        reason,
      });
      await modlog.sendModLog(interaction.guild, modlog.caseEmbed(interaction.guild, record, existing.user?.tag), "unban");
      return interaction.reply({ embeds: [success(`Unbanned <@${userId}> — Case #${record.caseNumber}.`)] });
    } catch (err) {
      return interaction.reply({ embeds: [danger(`Failed to unban: ${err.message}`)], ephemeral: true });
    }
  },
};

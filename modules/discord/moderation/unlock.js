// modules/discord/moderation/unlock.js — /unlock
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { canManageChannels } = require("../common/perms");
const { authorize } = require("../common/commandGuard");
const { danger, success, makeEmbed } = require("../common/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock a previously locked channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel to unlock (defaults to current)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)
    ),

  async execute(interaction) {
    if (!(await authorize(interaction, "unlock", canManageChannels))) return;

    const channel = interaction.options.getChannel("channel") || interaction.channel;

    try {
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }, {
        reason: `Unlocked by ${interaction.user.tag}`,
      });
      await channel.send({
        embeds: [makeEmbed({ color: "success", title: "🔓 Channel unlocked", description: "This channel has been unlocked." })],
      }).catch(() => {});
      return interaction.reply({ embeds: [success(`Unlocked ${channel}.`)], ephemeral: true });
    } catch (err) {
      return interaction.reply({ embeds: [danger(`Failed to unlock: ${err.message}`)], ephemeral: true });
    }
  },
};

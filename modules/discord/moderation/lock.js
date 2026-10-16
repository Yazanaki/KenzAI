// modules/discord/moderation/lock.js — /lock
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { canManageChannels } = require("../common/perms");
const { authorize } = require("../common/commandGuard");
const { danger, success } = require("../common/embeds");
const { makeEmbed } = require("../common/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock a channel so @everyone cannot send messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel to lock (defaults to current)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)
    )
    .addStringOption((o) => o.setName("reason").setDescription("Reason (announced in the channel)")),

  async execute(interaction) {
    if (!(await authorize(interaction, "lock", canManageChannels))) return;

    const channel = interaction.options.getChannel("channel") || interaction.channel;
    const reason = interaction.options.getString("reason");

    try {
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false }, {
        reason: `Locked by ${interaction.user.tag}`,
      });
      await channel.send({
        embeds: [makeEmbed({ color: "danger", title: "🔒 Channel locked", description: reason || "This channel has been locked by a moderator." })],
      }).catch(() => {});
      return interaction.reply({ embeds: [success(`Locked ${channel}.`)], ephemeral: true });
    } catch (err) {
      return interaction.reply({ embeds: [danger(`Failed to lock: ${err.message}`)], ephemeral: true });
    }
  },
};

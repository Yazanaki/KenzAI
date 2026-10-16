// modules/discord/moderation/purge.js — /purge
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { canManageMessages } = require("../common/perms");
const { authorize } = require("../common/commandGuard");
const { danger, success } = require("../common/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk-delete recent messages in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((o) =>
      o.setName("amount").setDescription("How many messages to delete (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)
    )
    .addUserOption((o) => o.setName("user").setDescription("Only delete messages from this user")),

  async execute(interaction) {
    if (!(await authorize(interaction, "purge", canManageMessages))) return;

    const amount = interaction.options.getInteger("amount");
    const user = interaction.options.getUser("user");
    const channel = interaction.channel;

    await interaction.deferReply({ ephemeral: true });

    let messages;
    try {
      messages = await channel.messages.fetch({ limit: user ? 100 : amount });
    } catch (err) {
      return interaction.editReply({ embeds: [danger(`Couldn't fetch messages: ${err.message}`)] });
    }

    const twoWeeksAgo = Date.now() - 14 * 86400 * 1000;
    let toDelete = messages.filter((m) => m.createdTimestamp > twoWeeksAgo);
    if (user) toDelete = toDelete.filter((m) => m.author.id === user.id);
    toDelete = [...toDelete.values()].slice(0, amount);

    if (!toDelete.length)
      return interaction.editReply({ embeds: [danger("No deletable messages found (messages older than 14 days can't be bulk-deleted).")] });

    try {
      const deleted = await channel.bulkDelete(toDelete, true);
      return interaction.editReply({
        embeds: [success(`Deleted **${deleted.size}** message(s)${user ? ` from ${user.tag}` : ""}.`)],
      });
    } catch (err) {
      return interaction.editReply({ embeds: [danger(`Failed to delete: ${err.message}`)] });
    }
  },
};

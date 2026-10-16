// modules/discord/moderation/slowmode.js — /slowmode
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { canManageChannels } = require("../common/perms");
const { authorize } = require("../common/commandGuard");
const { danger, success } = require("../common/embeds");
const { parseDuration, formatDuration } = require("../common/util");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set the slowmode delay for a channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName("duration").setDescription("e.g. 5s, 30s, 2m — use 0 to disable (max 6h)").setRequired(true)
    )
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel (defaults to current)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)
    ),

  async execute(interaction) {
    if (!(await authorize(interaction, "slowmode", canManageChannels))) return;

    const raw = interaction.options.getString("duration").trim();
    const channel = interaction.options.getChannel("channel") || interaction.channel;

    let seconds;
    if (raw === "0" || raw.toLowerCase() === "off") seconds = 0;
    else {
      const ms = parseDuration(raw);
      seconds = ms ? Math.round(ms / 1000) : NaN;
    }
    if (!Number.isFinite(seconds) || seconds < 0)
      return interaction.reply({ embeds: [danger("Invalid duration. Try `5s`, `30s`, `2m`, or `0` to disable.")], ephemeral: true });
    if (seconds > 21600)
      return interaction.reply({ embeds: [danger("Slowmode can be at most **6 hours**.")], ephemeral: true });

    try {
      await channel.setRateLimitPerUser(seconds, `Slowmode by ${interaction.user.tag}`);
      return interaction.reply({
        embeds: [success(seconds === 0 ? `Slowmode disabled in ${channel}.` : `Slowmode set to **${formatDuration(seconds * 1000)}** in ${channel}.`)],
      });
    } catch (err) {
      return interaction.reply({ embeds: [danger(`Failed to set slowmode: ${err.message}`)], ephemeral: true });
    }
  },
};

// modules/discord/levels/rank.js — /rank
const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const levelStore = require("./levelStore");
const { buildRankCard } = require("./rankCard");
const { getGuildSettings } = require("../settings/settingsStore");
const { makeEmbed } = require("../common/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show your (or someone's) level and rank")
    .setDMPermission(false)
    .addUserOption((o) => o.setName("user").setDescription("Whose rank to show")),

  async execute(interaction) {
    if (!getGuildSettings(interaction.guildId).leveling.enabled)
      return interaction.reply({ content: "Leveling is disabled on this server. An admin can enable it in `/setup` → Leveling.", ephemeral: true });

    const user = interaction.options.getUser("user") || interaction.user;
    if (user.bot) return interaction.reply({ content: "Bots don't earn XP.", ephemeral: true });

    await interaction.deferReply();

    const record = levelStore.get(interaction.guildId, user.id);
    const rank = levelStore.rankOf(interaction.guildId, user.id);
    const totalMembers = levelStore.forGuild(interaction.guildId).length;

    const png = await buildRankCard({ user, record, rank, totalMembers }).catch(() => null);
    if (png) {
      const file = new AttachmentBuilder(png, { name: "rank.png" });
      return interaction.editReply({ files: [file] });
    }

    // Fallback embed if canvas is unavailable.
    const info = levelStore.levelFromXp(record.xp);
    return interaction.editReply({
      embeds: [
        makeEmbed({
          color: "brand",
          title: `📈 ${user.username}'s rank`,
          fields: [
            { name: "Level", value: String(info.level), inline: true },
            { name: "Rank", value: rank ? `#${rank} / ${totalMembers}` : "unranked", inline: true },
            { name: "XP", value: `${info.intoLevel} / ${info.needed} (total ${record.xp})`, inline: true },
            { name: "Messages", value: String(record.messages || 0), inline: true },
            { name: "Voice", value: `${Math.floor((record.voiceSeconds || 0) / 60)} min`, inline: true },
          ],
        }),
      ],
    });
  },
};

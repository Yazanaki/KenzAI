// modules/discord/leaderboards/leaderboard.js — /leaderboard
// Paginated leaderboards for the leveling metrics (XP, messages, voice time).
const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const levelStore = require("../levels/levelStore");
const { getGuildSettings } = require("../settings/settingsStore");
const { makeEmbed } = require("../common/embeds");
const { clamp } = require("../common/util");

const PAGE_SIZE = 10;
const METRICS = {
  levels: { key: "xp", title: "🏆 Level Leaderboard", format: require("./levels/format") },
  messages: { key: "messages", title: "💬 Message Leaderboard", format: require("./messages/format") },
  voicecall: { key: "voiceSeconds", title: "🎙️ Voice Leaderboard", format: require("./voicecall/format") },
};

function buildPage(guildId, type, page) {
  const metric = METRICS[type] || METRICS.levels;
  const all = levelStore.top(guildId, metric.key).filter((r) => (r[metric.key] || 0) > 0);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  page = clamp(page, 0, pages - 1);
  const slice = all.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const lines = slice.map((r, i) => metric.format(r, page * PAGE_SIZE + i + 1));

  const embed = makeEmbed({
    color: "brand",
    title: metric.title,
    description: lines.join("\n") || "No data yet — start chatting or hop in voice!",
    footer: `Page ${page + 1}/${pages}`,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dlvl_lb_${type}_${page - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`dlvl_lb_${type}_${page + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
  );
  return { embed, components: pages > 1 ? [row] : [] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the server's XP / message / voice leaderboards")
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName("type").setDescription("Which leaderboard").addChoices(
        { name: "Levels (XP)", value: "levels" },
        { name: "Messages", value: "messages" },
        { name: "Voice time", value: "voicecall" }
      )
    ),

  async execute(interaction) {
    if (!getGuildSettings(interaction.guildId).leveling.enabled)
      return interaction.reply({ content: "Leveling is disabled on this server.", ephemeral: true });
    const type = interaction.options.getString("type") || "levels";
    const { embed, components } = buildPage(interaction.guildId, type, 0);
    return interaction.reply({ embeds: [embed], components });
  },

  async buttonHandler(interaction) {
    // customId: dlvl_lb_<type>_<page>
    const parts = interaction.customId.split("_");
    const type = parts[2];
    const page = Number(parts[3]) || 0;
    const { embed, components } = buildPage(interaction.guildId, type, page);
    return interaction.update({ embeds: [embed], components });
  },
};

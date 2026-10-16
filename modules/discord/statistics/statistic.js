// modules/discord/statistics/statistic.js — /statistic
// Interactive statistics viewer: an embed with a metric dropdown (user joins,
// user leaves, messages, voice time) and a timeframe dropdown (24h / 7d / 2w /
// 30d). Both selects re-render the embed; each carries the other dimension in
// its customId so no server-side state is needed.
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const statsStore = require("./statsStore");
const { getGuildSettings } = require("../settings/settingsStore");
const { makeEmbed } = require("../common/embeds");

function fmtSeconds(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
const asInt = (n) => String(n);

const METRICS = {
  joins: { label: "User joins", emoji: "📥", field: "joins", fmt: asInt },
  leaves: { label: "User leaves", emoji: "📤", field: "leaves", fmt: asInt },
  messages: { label: "Messages", emoji: "💬", field: "messages", fmt: asInt },
  voice: { label: "Voice time", emoji: "🎙️", field: "voiceSeconds", fmt: fmtSeconds },
};
const TIMEFRAMES = [
  { value: "1", label: "Last 24 hours", days: 1 },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "14", label: "Last 2 weeks", days: 14 },
  { value: "30", label: "Last 30 days", days: 30 },
];

function recentDays(days) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < days; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out; // most-recent first
}

function render(guild, metricKey, daysStr) {
  const m = METRICS[metricKey] || METRICS.messages;
  const days = Number(daysStr) || 7;
  const tf = TIMEFRAMES.find((t) => t.value === String(days)) || TIMEFRAMES[1];

  const rec = statsStore.get(guild.id);
  const total = statsStore.rangeSum(guild.id, m.field, days);
  const allTime = rec[m.field] || 0;

  // Per-day breakdown (cap the list length so the embed stays tidy).
  const daily = rec.daily || {};
  const dayKeys = recentDays(Math.min(days, 14));
  const breakdown = dayKeys.map((k) => `\`${k.slice(5)}\` ${m.fmt(daily[k]?.[m.field] || 0)}`).join("\n");

  const embed = makeEmbed({
    title: `${m.emoji} ${guild.name} — ${m.label}`,
    color: "brand",
    description: `**${m.fmt(total)}** over ${tf.label.toLowerCase()}`,
    fields: [
      { name: tf.label, value: m.fmt(total), inline: true },
      { name: "All time", value: m.fmt(allTime), inline: true },
      { name: `Per day${days > 14 ? " (last 14)" : ""}`, value: breakdown || "*no data*", inline: false },
    ],
    footer: "Counters started when statistics were enabled",
    timestamp: true,
  });

  const metricRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`dstat_metric|${days}`)
      .setPlaceholder("Choose a statistic…")
      .addOptions(Object.entries(METRICS).map(([k, v]) => ({ label: v.label, value: k, emoji: v.emoji, default: k === metricKey })))
  );
  const timeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`dstat_time|${metricKey}`)
      .setPlaceholder("Choose a timeframe…")
      .addOptions(TIMEFRAMES.map((t) => ({ label: t.label, value: t.value, default: t.value === String(days) })))
  );
  return { embeds: [embed], components: [metricRow, timeRow] };
}

module.exports = {
  data: new SlashCommandBuilder().setName("statistic").setDescription("View server statistics (joins, leaves, messages, voice) over time").setDMPermission(false),

  async execute(interaction) {
    if (!getGuildSettings(interaction.guildId).statistics.enabled)
      return interaction.reply({ content: "Statistics are disabled. An admin can enable them in `/setup` → Statistics.", ephemeral: true });
    return interaction.reply(render(interaction.guild, "messages", "7"));
  },

  async selectMenuHandler(interaction) {
    const [base, param] = interaction.customId.split("|");
    const value = interaction.values[0];
    let metricKey, days;
    if (base === "dstat_metric") {
      metricKey = value;
      days = param;
    } else {
      metricKey = param;
      days = value;
    }
    return interaction.update(render(interaction.guild, metricKey, days));
  },
};

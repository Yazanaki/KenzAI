// modules/discord/statistics/messages/collector.js
// Counts messages (buffered) and logs deleted/edited messages.
const statsStore = require("../statsStore");
const { getGuildSettings } = require("../../settings/settingsStore");
const { makeEmbed } = require("../../common/embeds");

function logChannel(guild) {
  const stats = getGuildSettings(guild.id).statistics;
  if (!stats.enabled || !stats.logs.messageChannelId) return null;
  const ch = guild.channels.cache.get(stats.logs.messageChannelId);
  return ch?.isTextBased() ? ch : null;
}

function handleMessage(message) {
  try {
    if (!message.guild || message.author?.bot || message.system) return;
    if (!getGuildSettings(message.guild.id).statistics.enabled) return;
    statsStore.recordMessage(message.guild.id);
  } catch {
    /* ignore */
  }
}

async function handleDelete(message) {
  try {
    if (!message.guild) return;
    if (message.author?.bot) return;
    const ch = logChannel(message.guild);
    if (!ch) return;
    const content = message.content ? message.content.slice(0, 1024) : "*no text content (embed/attachment or uncached)*";
    await ch
      .send({
        embeds: [
          makeEmbed({
            color: "danger",
            title: "🗑️ Message deleted",
            description: `In <#${message.channelId}>${message.author ? ` by <@${message.author.id}>` : ""}`,
            fields: [{ name: "Content", value: content }],
            footer: message.author ? `Author ID: ${message.author.id}` : undefined,
            timestamp: true,
          }),
        ],
      })
      .catch(() => {});
  } catch (err) {
    console.error("[discord/stats] ❌ msg delete:", err.message);
  }
}

async function handleEdit(oldMessage, newMessage) {
  try {
    const guild = newMessage.guild || oldMessage.guild;
    if (!guild) return;
    if (newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return; // embed-only edit, ignore
    const ch = logChannel(guild);
    if (!ch) return;
    await ch
      .send({
        embeds: [
          makeEmbed({
            color: "warn",
            title: "✏️ Message edited",
            description: `In <#${newMessage.channelId}>${newMessage.author ? ` by <@${newMessage.author.id}>` : ""} — [jump](${newMessage.url})`,
            fields: [
              { name: "Before", value: (oldMessage.content || "*uncached*").slice(0, 1024) },
              { name: "After", value: (newMessage.content || "*empty*").slice(0, 1024) },
            ],
            footer: newMessage.author ? `Author ID: ${newMessage.author.id}` : undefined,
            timestamp: true,
          }),
        ],
      })
      .catch(() => {});
  } catch (err) {
    console.error("[discord/stats] ❌ msg edit:", err.message);
  }
}

module.exports = { handleMessage, handleDelete, handleEdit };

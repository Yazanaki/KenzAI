// modules/discord/common/embeds.js
// Thin EmbedBuilder helpers so every feature renders a consistent look.

const { EmbedBuilder } = require("discord.js");
const { EMBED_COLORS } = require("../discordconfig");

/**
 * Build an embed from a plain options object.
 * @param {Object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.description]
 * @param {number|string} [opts.color]  numeric color or an EMBED_COLORS key
 * @param {Array}  [opts.fields]
 * @param {string} [opts.footer]
 * @param {string} [opts.thumbnail]
 * @param {string} [opts.image]
 * @param {boolean} [opts.timestamp]
 */
function makeEmbed(opts = {}) {
  const embed = new EmbedBuilder();
  if (opts.title) embed.setTitle(opts.title);
  if (opts.description) embed.setDescription(opts.description);

  let color = opts.color;
  if (typeof color === "string") color = EMBED_COLORS[color] ?? EMBED_COLORS.brand;
  embed.setColor(color ?? EMBED_COLORS.brand);

  if (Array.isArray(opts.fields) && opts.fields.length) embed.addFields(opts.fields);
  if (opts.footer) embed.setFooter({ text: opts.footer });
  if (opts.thumbnail) embed.setThumbnail(opts.thumbnail);
  if (opts.image) embed.setImage(opts.image);
  if (opts.timestamp) embed.setTimestamp();
  return embed;
}

const success = (description, extra = {}) =>
  makeEmbed({ color: "success", description: `✅ ${description}`, ...extra });
const danger = (description, extra = {}) =>
  makeEmbed({ color: "danger", description: `❌ ${description}`, ...extra });
const warn = (description, extra = {}) =>
  makeEmbed({ color: "warn", description: `⚠️ ${description}`, ...extra });
const info = (description, extra = {}) =>
  makeEmbed({ color: "info", description, ...extra });

module.exports = { makeEmbed, success, danger, warn, info };

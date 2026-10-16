// modules/discord/boosters/roleStyle.js
// Applies color (incl. gradient), emoji, and icon to a role using discord.js
// 14.26 APIs, with guild-feature guards. Gradient needs ENHANCED_ROLE_COLORS;
// role icon/emoji needs ROLE_ICONS. Returns which parts applied + warnings.

function supportsGradient(guild) {
  return guild.features?.includes("ENHANCED_ROLE_COLORS");
}
function supportsIcons(guild) {
  return guild.features?.includes("ROLE_ICONS");
}

/** Parse "#RRGGBB" / "RRGGBB" / "#RGB" into an int, or null if invalid. */
function hexToInt(hex) {
  if (!hex) return null;
  let h = String(hex).trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return parseInt(h, 16);
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 * @param {Object} style { primaryHex, secondaryHex, emoji, iconUrl }
 * @param {Object} settings booster settings block (allowGradient, allowIcons)
 * @returns {Promise<{ warnings: string[] }>}
 */
async function applyRoleStyle(guild, role, style, settings = {}) {
  const warnings = [];
  const editData = {};

  const primary = hexToInt(style.primaryHex);
  if (style.primaryHex && primary == null) warnings.push(`\`${style.primaryHex}\` isn't a valid hex color — color unchanged.`);
  if (primary != null) {
    const colors = { primaryColor: primary };
    if (style.secondaryHex) {
      const secondary = hexToInt(style.secondaryHex);
      if (secondary == null) warnings.push(`\`${style.secondaryHex}\` isn't a valid hex color — no gradient applied.`);
      else if (!settings.allowGradient) warnings.push("Gradient roles are disabled on this server.");
      else if (!supportsGradient(guild)) warnings.push("This server doesn't have gradient role support (needs 3 boosts / Enhanced Role Styles).");
      else colors.secondaryColor = secondary;
    }
    editData.colors = colors;
  }

  // Icon / emoji (mutually exclusive; icon image wins if both given).
  if (style.iconUrl || style.emoji) {
    if (!settings.allowIcons) warnings.push("Role icons/emojis are disabled on this server.");
    else if (!supportsIcons(guild)) warnings.push("This server can't set role icons (needs Boost Level 2).");
    else if (style.iconUrl) editData.icon = style.iconUrl;
    else editData.unicodeEmoji = style.emoji;
  }

  if (Object.keys(editData).length) {
    await role.edit(editData);
  }
  return { warnings };
}

module.exports = { applyRoleStyle, hexToInt, supportsGradient, supportsIcons };

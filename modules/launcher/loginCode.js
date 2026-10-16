// modules/launcher/loginCode.js
// Delivers Yazanaki Client sign-in codes by DM. YazanakiAPI generates the
// one-time 6-digit code (and only stores its hash); it calls KenzAI's internal
// endpoint (/internal/login-code in cosmeticsServer.js) so the code arrives
// from the bot members already know. KenzAI never stores the code.

"use strict";

const { EmbedBuilder } = require("discord.js");

const CODE_RE = /^\d{6}$/;
const DISCORD_ID_RE = /^\d{17,20}$/;

/**
 * DM a sign-in code to a member.
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
async function sendLoginCode(client, { discordId, code, empireId, expiresInMinutes }) {
  if (!client) return { ok: false, reason: "bot_not_ready" };
  if (!DISCORD_ID_RE.test(String(discordId)) || !CODE_RE.test(String(code))) {
    return { ok: false, reason: "invalid_fields" };
  }

  let user;
  try {
    user = await client.users.fetch(String(discordId));
  } catch {
    return { ok: false, reason: "user_not_found" };
  }

  const minutes = Number(expiresInMinutes) > 0 ? Number(expiresInMinutes) : 5;
  const embed = new EmbedBuilder()
    .setColor(0xb8323b)
    .setTitle("Yazanaki Client sign-in code")
    .setDescription(
      `Your code is **\`${code}\`**\n\n` +
        `Enter it in the Yazanaki Client to sign in${empireId ? ` as **${empireId}**` : ""}. ` +
        `It works once and expires in ${minutes} minutes.\n\n` +
        "If you didn't try to sign in, ignore this message. Nobody from the Empire will ever ask you for this code."
    )
    .setTimestamp(new Date());

  try {
    await user.send({ embeds: [embed] });
    return { ok: true };
  } catch (err) {
    // 50007: Cannot send messages to this user (DMs closed / no shared server).
    if (err && err.code === 50007) return { ok: false, reason: "dm_closed" };
    console.error("[launcher/loginCode] ❌ DM failed:", err && err.message);
    return { ok: false, reason: "dm_failed" };
  }
}

module.exports = { sendLoginCode };

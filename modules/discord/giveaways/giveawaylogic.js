// modules/discord/giveaways/giveawaylogic.js
// Giveaway rendering, entry requirements, winner selection, and end/reroll.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const store = require("./giveawayStore");
const levelStore = require("../levels/levelStore");
const { getGuildSettings } = require("../settings/settingsStore");
const { EMBED_COLORS } = require("../discordconfig");

function emoji(guildId) {
  return getGuildSettings(guildId).giveaways.emoji || "🎉";
}

const ts = (v) => Math.floor(new Date(v).getTime() / 1000);
const { formatDuration } = require("../common/util");

function buildEmbed(record) {
  const e = emoji(record.guildId);
  const status = record.status || "active";
  const reqs = [];
  if (record.requiredRoleId) reqs.push(`Role: <@&${record.requiredRoleId}>`);
  if (record.requiredLevel) reqs.push(`Level: **${record.requiredLevel}+**`);

  const stampSource = record.endsAt || record.startsAt || Date.now();
  const embed = new EmbedBuilder()
    .setColor(status === "active" ? EMBED_COLORS.brand : EMBED_COLORS.neutral)
    .setTitle(`${e} ${record.prize} ${e}`)
    .setFooter({ text: `${record.winnerCount} winner${record.winnerCount > 1 ? "s" : ""} • ${record.entries.length} entries` })
    .setTimestamp(new Date(stampSource));

  const lines = [];
  if (status === "scheduled") {
    lines.push(`⏳ This giveaway hasn't started yet.`);
    if (record.startsAt) lines.push(`Starts: <t:${ts(record.startsAt)}:R>`);
    if (record.durationMs) lines.push(`Will run for **${formatDuration(record.durationMs)}**`);
  } else if (status === "active") {
    lines.push(`Click the button below to enter!`);
    lines.push(`Ends: <t:${ts(record.endsAt)}:R>`);
  } else {
    lines.push(
      record.winnerIds && record.winnerIds.length
        ? `Winner${record.winnerIds.length > 1 ? "s" : ""}: ${record.winnerIds.map((id) => `<@${id}>`).join(", ")}`
        : "Ended — no valid entries."
    );
    lines.push(`Ended: <t:${ts(record.endedAt || record.endsAt || Date.now())}:R>`);
  }
  lines.push(`Hosted by: <@${record.hostId}>`);
  if (reqs.length) lines.push(`\n**Requirements**\n${reqs.join("\n")}`);
  const bonus = Object.entries(record.bonusEntries || {});
  if (bonus.length) lines.push(`\n**Bonus entries**\n${bonus.map(([r, n]) => `<@&${r}>: +${n}`).join("\n")}`);
  embed.setDescription(lines.join("\n"));
  return embed;
}

function buildRow(messageId, { disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dgw_enter_${messageId}`)
      .setLabel("Enter")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

/** @returns {{ok: boolean, reason?: string}} */
function meetsRequirements(member, record) {
  if (record.requiredRoleId && !member.roles.cache.has(record.requiredRoleId))
    return { ok: false, reason: `You need the <@&${record.requiredRoleId}> role to enter.` };
  if (record.requiredLevel) {
    const lvl = levelStore.get(record.guildId, member.id).level;
    if (lvl < record.requiredLevel)
      return { ok: false, reason: `You need to be level **${record.requiredLevel}+** to enter (you're level ${lvl}).` };
  }
  return { ok: true };
}

/**
 * Parse a "bonus roles" string into a { roleId: extraEntries } map. Accepts
 * role mentions each followed by a number, e.g. "<@&123> 2 <@&456> 3"
 * (what Discord sends when you type "@VIP 2 @Booster 3"). A mention with no
 * number defaults to 1 extra entry; amounts are clamped to 1..100.
 */
function parseBonusRoles(input) {
  const out = {};
  if (!input) return out;
  const re = /<@&(\d+)>\s*(\d+)?/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    const roleId = m[1];
    const n = m[2] ? parseInt(m[2], 10) : 1;
    if (n > 0) out[roleId] = Math.min(100, n);
  }
  return out;
}

/** Total entries a member has: 1 base + bonus entries for each qualifying role. */
function entryWeight(member, bonusEntries) {
  let weight = 1;
  if (bonusEntries) {
    for (const [roleId, extra] of Object.entries(bonusEntries)) {
      if (member.roles.cache.has(roleId)) weight += Number(extra) || 0;
    }
  }
  return Math.max(1, weight);
}

/**
 * Pick up to `count` unique winners from valid entrants, weighted by bonus
 * entries (members with configured roles get extra entries -> higher odds).
 * Uses weighted sampling without replacement.
 */
async function pickWinners(guild, record, count, exclude = []) {
  const bonusEntries = record.bonusEntries || {};
  const pool = []; // { id, w }
  for (const userId of record.entries) {
    if (exclude.includes(userId)) continue;
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
    if (!member) continue;
    if (!meetsRequirements(member, record).ok) continue;
    pool.push({ id: userId, w: entryWeight(member, bonusEntries) });
  }

  const winners = [];
  for (let n = 0; n < count && pool.length; n++) {
    const total = pool.reduce((a, p) => a + p.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].w;
      if (r <= 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    winners.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return winners;
}

async function fetchMessage(client, record) {
  const guild = client.guilds.cache.get(record.guildId);
  if (!guild) return { guild: null };
  const channel = guild.channels.cache.get(record.channelId) || (await guild.channels.fetch(record.channelId).catch(() => null));
  if (!channel?.isTextBased()) return { guild, channel: null };
  const message = await channel.messages.fetch(record.messageId).catch(() => null);
  return { guild, channel, message };
}

/**
 * Post and save a brand-new active giveaway from a set of params (used by the
 * recurring scheduler). Returns { ok, record }.
 */
async function launchGiveaway(client, opts) {
  const guild = client.guilds.cache.get(opts.guildId);
  if (!guild) return { ok: false, reason: "guild" };
  const channel = guild.channels.cache.get(opts.channelId) || (await guild.channels.fetch(opts.channelId).catch(() => null));
  if (!channel?.isTextBased()) return { ok: false, reason: "channel" };

  const now = Date.now();
  const record = {
    messageId: null,
    guildId: opts.guildId,
    channelId: opts.channelId,
    prize: opts.prize,
    winnerCount: opts.winnerCount || 1,
    hostId: opts.hostId,
    durationMs: opts.durationMs,
    startsAt: new Date(now).toISOString(),
    endsAt: new Date(now + opts.durationMs).toISOString(),
    status: "active",
    entries: [],
    requiredRoleId: opts.requiredRoleId || null,
    requiredLevel: opts.requiredLevel || 0,
    bonusEntries: opts.bonusEntries || {},
    winnerIds: [],
    createdAt: new Date(now).toISOString(),
  };
  const msg = await channel.send({ embeds: [buildEmbed(record)] });
  record.messageId = msg.id;
  await msg.edit({ embeds: [buildEmbed(record)], components: [buildRow(msg.id)] });
  store.save(record);
  return { ok: true, record };
}

/** Activate a scheduled giveaway: flip to active, set endsAt, enable entry. */
async function activateGiveaway(client, record) {
  const { guild, channel, message } = await fetchMessage(client, record);
  if (!guild) {
    store.remove(record.messageId);
    return { ok: false };
  }
  record.status = "active";
  record.endsAt = new Date(Date.now() + (record.durationMs || 0)).toISOString();
  store.save(record);

  if (message) {
    await message.edit({ embeds: [buildEmbed(record)], components: [buildRow(record.messageId)] }).catch(() => {});
  }
  if (channel) {
    await channel.send({ content: `${emoji(record.guildId)} The giveaway for **${record.prize}** has started — good luck!` }).catch(() => {});
  }
  return { ok: true };
}

/** End a giveaway: pick winners, update the message, announce. */
async function endGiveaway(client, record) {
  const { guild, channel, message } = await fetchMessage(client, record);
  if (!guild) {
    store.remove(record.messageId);
    return { ok: false };
  }

  const winners = await pickWinners(guild, record, record.winnerCount);
  record.status = "ended";
  record.endedAt = new Date().toISOString();
  record.winnerIds = winners;
  store.save(record);

  if (message) {
    await message.edit({ embeds: [buildEmbed(record)], components: [buildRow(record.messageId, { disabled: true })] }).catch(() => {});
  }
  if (channel) {
    const e = emoji(record.guildId);
    const text = winners.length
      ? `${e} Congratulations ${winners.map((id) => `<@${id}>`).join(", ")}! You won **${record.prize}**!`
      : `${e} The giveaway for **${record.prize}** ended with no valid entries.`;
    await channel.send({ content: text, allowedMentions: { users: winners } }).catch(() => {});
  }
  return { ok: true, winners };
}

/** Reroll: pick new winners (excluding the previous ones) and announce. */
async function rerollGiveaway(client, record, count) {
  const { guild, channel } = await fetchMessage(client, record);
  if (!guild) return { ok: false, reason: "Guild not found." };
  const winners = await pickWinners(guild, record, count || record.winnerCount, record.winnerIds || []);
  if (!winners.length) return { ok: false, reason: "No eligible entries to reroll." };
  record.winnerIds = [...(record.winnerIds || []), ...winners];
  store.save(record);
  if (channel) {
    const e = emoji(record.guildId);
    await channel
      .send({ content: `${e} Reroll! New winner${winners.length > 1 ? "s" : ""}: ${winners.map((id) => `<@${id}>`).join(", ")} — **${record.prize}**!`, allowedMentions: { users: winners } })
      .catch(() => {});
  }
  return { ok: true, winners };
}

module.exports = {
  buildEmbed,
  buildRow,
  meetsRequirements,
  entryWeight,
  parseBonusRoles,
  pickWinners,
  launchGiveaway,
  activateGiveaway,
  endGiveaway,
  rerollGiveaway,
  emoji,
};

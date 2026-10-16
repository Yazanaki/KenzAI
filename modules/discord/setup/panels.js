// modules/discord/setup/panels.js
// Renders the /setup dashboard — the single configuration surface for every
// Discord submodule. A category dropdown plus per-category controls: native
// channel/role pickers, toggle buttons, sub-navigation, and modals for numeric
// / text / map settings. Panels are stateless: every render reads current
// settings; transient navigation state (sub-page, selected rule) rides in `ctx`
// and is encoded into component customIds, so no server-side session is needed.
//
// customId scheme (prefix "dset_", "|" separates params) is documented inline
// next to each control and handled in setup.js.

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");
const { getGuildSettings } = require("../settings/settingsStore");
const { makeEmbed } = require("../common/embeds");
const ca = require("./clanAlliance");

const CATEGORIES = [
  { value: "overview", label: "Overview", emoji: "📋", description: "Everything at a glance" },
  { value: "moderation", label: "Moderation logs", emoji: "📜", description: "A channel per moderation action + DM behaviour" },
  { value: "modroles", label: "Moderation roles", emoji: "🛡️", description: "Which roles may run which commands" },
  { value: "automod", label: "Automod", emoji: "🤖", description: "Spam, invites, mentions, caps, words, raids" },
  { value: "leveling", label: "Leveling", emoji: "📈", description: "Message + voice XP, rewards, announcements" },
  { value: "invites", label: "Invite tracking", emoji: "📨", description: "Fake threshold, join log, milestone rewards" },
  { value: "statistics", label: "Statistics", emoji: "📊", description: "Join/leave, message, voice logging" },
  { value: "giveaways", label: "Giveaways", emoji: "🎉", description: "Host roles and entry emoji" },
  { value: "clan", label: "Clan", emoji: "⚔️", description: "Clan channels + managing roles" },
  { value: "alliance", label: "Alliance", emoji: "🤝", description: "Alliance channels + managing roles" },
  { value: "boosters", label: "Booster roles", emoji: "💜", description: "Self-service + multi-booster roles" },
];

const chan = (id) => (id ? `<#${id}>` : "*not set*");
const roleList = (ids) => (ids && ids.length ? ids.map((r) => `<@&${r}>`).join(", ") : "*none*");
const onoff = (v) => (v ? "✅ on" : "❌ off");

// ---- component helpers (with current-value defaults) ----
function categoryRow(current) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("dset_cat")
      .setPlaceholder("Choose a settings category…")
      .addOptions(CATEGORIES.map((c) => ({ label: c.label, value: c.value, description: c.description, emoji: c.emoji, default: c.value === current })))
  );
}
function backRow(category, label = "◀ Back") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dset_open|${category}|`).setLabel(label).setStyle(ButtonStyle.Secondary)
  );
}
function channelSelect(customId, placeholder, currentIds, { max = 1 } = {}) {
  const ids = [].concat(currentIds || []).filter(Boolean);
  const menu = new ChannelSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice).setMinValues(0).setMaxValues(max);
  if (ids.length) menu.setDefaultChannels(...ids.slice(0, max));
  return new ActionRowBuilder().addComponents(menu);
}
function roleSelect(customId, placeholder, currentIds, { max = 25 } = {}) {
  const ids = [].concat(currentIds || []).filter(Boolean);
  const menu = new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(0).setMaxValues(max);
  if (ids.length) menu.setDefaultRoles(...ids.slice(0, max));
  return new ActionRowBuilder().addComponents(menu);
}
function toggleBtn(customId, label, on) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
}
function actionBtn(customId, label, emoji) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Primary);
  if (emoji) b.setEmoji(emoji);
  return b;
}

const ACTION_CHOICES = [
  { label: "Delete message", value: "delete" },
  { label: "Delete + warn", value: "warn" },
  { label: "Delete + mute", value: "mute" },
];

// ---- per-category renderers ----
function renderModeration(s, components, ctx) {
  const logs = s.moderation.logs || {};
  const embed = makeEmbed({
    title: "📜 Moderation logs",
    color: "brand",
    description: `Assign a channel per action (falls back to the mod-log channel).\nFallback: ${chan(s.moderation.modLogChannelId)} · DM on action: ${onoff(s.moderation.dmOnAction)}`,
    fields: Object.keys(logs).map((a) => ({ name: a, value: chan(logs[a]), inline: true })),
  });
  components.push(new ActionRowBuilder().addComponents(toggleBtn("dset_mod_dm", "DM on action", s.moderation.dmOnAction)));
  components.push(channelSelect("dset_ml_fallback", "Fallback mod-log channel…", s.moderation.modLogChannelId));
  components.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("dset_ml_action").setPlaceholder("Pick an action to set its channel…").addOptions(Object.keys(logs).map((a) => ({ label: a, value: a, default: a === ctx.action })))
    )
  );
  if (ctx.action) components.push(channelSelect(`dset_ml_chan|${ctx.action}`, `Channel for "${ctx.action}" (clear = fallback)…`, logs[ctx.action]));
  return embed;
}

function renderModroles(s, components, ctx) {
  const perms = s.permissions || { groups: {}, commandGroup: {} };
  const embed = makeEmbed({
    title: "🛡️ Moderation roles",
    color: "brand",
    description: "Grant command access by role. Admins/Manage Server always pass. A command with roles set is restricted to those roles; otherwise it uses the built-in Discord permission.",
    fields: [
      ...Object.entries(perms.groups).map(([g, ids]) => ({ name: `Group: ${g}`, value: roleList(ids), inline: true })),
      { name: "Command → group", value: Object.entries(perms.commandGroup).map(([c, g]) => `\`${c}\`→${g}`).join("  ") || "*none*", inline: false },
    ],
  });
  components.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("dset_mr_pickgroup").setPlaceholder("Pick a group to set its roles…").addOptions(Object.keys(perms.groups).map((g) => ({ label: g, value: g, default: g === ctx.group })))
    )
  );
  if (ctx.group) components.push(roleSelect(`dset_mr_setroles|${ctx.group}`, `Roles for "${ctx.group}"…`, perms.groups[ctx.group]));
  components.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("dset_mr_pickcmd").setPlaceholder("Pick a command to map to a group…").addOptions(Object.keys(perms.commandGroup).slice(0, 25).map((c) => ({ label: c, value: c, default: c === ctx.command })))
    )
  );
  if (ctx.command)
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`dset_mr_setcmdgroup|${ctx.command}`).setPlaceholder(`Group for /${ctx.command}…`).addOptions(Object.keys(perms.groups).map((g) => ({ label: g, value: g, default: perms.commandGroup[ctx.command] === g })))
      )
    );
  return embed;
}

const AM_RULES = [
  { key: "antiInvite", label: "Anti-invite" },
  { key: "antiSpam", label: "Anti-spam" },
  { key: "antiMention", label: "Anti-mention" },
  { key: "antiCaps", label: "Anti-caps" },
  { key: "wordFilter", label: "Word filter" },
  { key: "antiRaid", label: "Anti-raid" },
];

function renderAutomod(s, components, ctx) {
  const a = s.automod;
  // Sub-page: exemptions
  if (ctx.sub === "exempt") {
    const embed = makeEmbed({
      title: "🤖 Automod — exemptions",
      color: "brand",
      description: "Roles and channels that bypass all automod rules. (Members with Manage Messages always bypass.)",
      fields: [
        { name: "Exempt roles", value: roleList(a.exemptRoleIds), inline: false },
        { name: "Exempt channels", value: a.exemptChannelIds.length ? a.exemptChannelIds.map((c) => `<#${c}>`).join(", ") : "*none*", inline: false },
      ],
    });
    components.push(backRow("automod"));
    components.push(roleSelect("dset_am_exempt_roles", "Exempt roles…", a.exemptRoleIds));
    components.push(channelSelect("dset_am_exempt_channels", "Exempt channels…", a.exemptChannelIds, { max: 25 }));
    return embed;
  }
  // Sub-page: a specific rule
  const rule = AM_RULES.find((r) => r.key === ctx.rule);
  if (rule) {
    const r = a[rule.key];
    let detail;
    switch (rule.key) {
      case "antiInvite": detail = "Blocks Discord invite links."; break;
      case "antiSpam": detail = `Blocks ${r.maxMessages} msgs / ${Math.round(r.intervalMs / 1000)}s. Mute: ${r.muteSeconds}s.`; break;
      case "antiMention": detail = `Blocks > ${r.maxMentions} mentions. Mute: ${r.muteSeconds}s.`; break;
      case "antiCaps": detail = `${r.percent}% caps over ${r.minLength} chars.`; break;
      case "wordFilter": detail = `${(r.words || []).length} blocked word(s).`; break;
      case "antiRaid": detail = `${r.joinCount} joins / ${Math.round(r.intervalMs / 1000)}s → ${r.action}.`; break;
      default: detail = "";
    }
    const embed = makeEmbed({ title: `🤖 Automod — ${rule.label}`, color: "brand", description: `${onoff(r.enabled)} · action: \`${r.action}\`\n${detail}` });
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`dset_open|automod|`).setLabel("◀ Back").setStyle(ButtonStyle.Secondary),
      toggleBtn(`dset_am_ruletoggle|${rule.key}`, r.enabled ? "Enabled" : "Disabled", r.enabled)
    );
    if (["antiSpam", "antiMention", "antiCaps", "antiRaid"].includes(rule.key)) row1.addComponents(actionBtn(`dset_am_thresh|${rule.key}`, "Edit values"));
    if (rule.key === "wordFilter") row1.addComponents(actionBtn("dset_am_words", "Edit words"));
    components.push(row1);
    if (rule.key === "antiRaid") {
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`dset_am_action|${rule.key}`).setPlaceholder("Action on raid…").addOptions(
            { label: "Alert only", value: "alert", default: r.action === "alert" },
            { label: "Kick new joiners", value: "kick", default: r.action === "kick" },
            { label: "Ban new joiners", value: "ban", default: r.action === "ban" }
          )
        )
      );
    } else {
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`dset_am_action|${rule.key}`).setPlaceholder("Action on violation…").addOptions(ACTION_CHOICES.map((c) => ({ ...c, default: r.action === c.value })))
        )
      );
    }
    return embed;
  }
  // Main automod page
  const embed = makeEmbed({
    title: "🤖 Automod",
    color: "brand",
    description: `${onoff(a.enabled)} · Log: ${chan(a.logChannelId)} (falls back to mod-log)`,
    fields: AM_RULES.map((r) => ({ name: r.label, value: `${onoff(a[r.key].enabled)} → \`${a[r.key].action}\``, inline: true })),
  });
  components.push(new ActionRowBuilder().addComponents(toggleBtn("dset_am_enabled", "Automod", a.enabled), actionBtn("dset_open|automod|exempt", "Exemptions", "🚫")));
  components.push(channelSelect("dset_am_log", "Automod log channel…", a.logChannelId));
  components.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("dset_am_rule").setPlaceholder("Configure a rule…").addOptions(AM_RULES.map((r) => ({ label: r.label, value: r.key, description: `${a[r.key].enabled ? "on" : "off"} → ${a[r.key].action}` })))
    )
  );
  return embed;
}

function renderLeveling(s, components, ctx) {
  const lv = s.leveling;
  if (ctx.sub === "rewards") {
    const rewards = Object.entries(lv.roleRewards || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    const embed = makeEmbed({
      title: "📈 Leveling — role rewards",
      color: "brand",
      description: `Pick a role, then enter the level it's granted at. Stacking: ${onoff(lv.stackRewards)}.`,
      fields: [{ name: "Rewards", value: rewards.map(([l, r]) => `Lv ${l} → <@&${r}>`).join("\n") || "*none*" }],
    });
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("dset_open|leveling|").setLabel("◀ Back").setStyle(ButtonStyle.Secondary), toggleBtn("dset_lvl_stack", "Stack rewards", lv.stackRewards)));
    components.push(roleSelect("dset_lvl_reward_role", "Pick a role to add as a reward…", [], { max: 1 }));
    if (rewards.length)
      components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("dset_lvl_delreward").setPlaceholder("Remove a reward…").addOptions(rewards.map(([l, r]) => ({ label: `Level ${l}`, value: l, description: `role ${r}` })))));
    return embed;
  }
  if (ctx.sub === "mult") {
    const mults = Object.entries(lv.multiplierRoles || {});
    const embed = makeEmbed({ title: "📈 Leveling — XP multipliers", color: "brand", description: "Pick a role, then enter its XP multiplier (0 removes).", fields: [{ name: "Multipliers", value: mults.map(([r, f]) => `<@&${r}> ×${f}`).join("\n") || "*none*" }] });
    components.push(backRow("leveling"));
    components.push(roleSelect("dset_lvl_mult_role", "Pick a role to set a multiplier…", [], { max: 1 }));
    if (mults.length)
      components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("dset_lvl_delmult").setPlaceholder("Remove a multiplier…").addOptions(mults.map(([r, f]) => ({ label: `role ${r}`, value: r, description: `×${f}` })))));
    return embed;
  }
  if (ctx.sub === "announce") {
    const embed = makeEmbed({
      title: "📈 Leveling — level-up announcements",
      color: "brand",
      description: `${onoff(lv.announceLevelUp)} · target: **${lv.announceTarget}**\nMessage: ${lv.levelUpMessage}`,
    });
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("dset_open|leveling|").setLabel("◀ Back").setStyle(ButtonStyle.Secondary), toggleBtn("dset_lvl_announce_toggle", "Announce", lv.announceLevelUp), actionBtn("dset_lvl_announce_msg", "Edit message")));
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("dset_lvl_announce_target").setPlaceholder("Where to announce…").addOptions(
          { label: "Current channel", value: "current", default: lv.announceTarget === "current" },
          { label: "Direct message", value: "dm", default: lv.announceTarget === "dm" },
          { label: "A specific channel (pick below)", value: "channel", default: !["current", "dm"].includes(lv.announceTarget) }
        )
      )
    );
    if (!["current", "dm"].includes(lv.announceTarget)) components.push(channelSelect("dset_lvl_announce_channel", "Announcement channel…", lv.announceTarget));
    return embed;
  }
  // Main leveling page
  const embed = makeEmbed({
    title: "📈 Leveling",
    color: "brand",
    description: `${onoff(lv.enabled)}`,
    fields: [
      { name: "Message XP", value: `${lv.xpPerMessageMin}–${lv.xpPerMessageMax} / ${lv.messageCooldownSeconds}s`, inline: true },
      { name: "Voice XP", value: `${lv.voiceXpPerMinute}/min`, inline: true },
      { name: "Announce", value: lv.announceLevelUp ? lv.announceTarget : "off", inline: true },
      { name: "No-XP channels", value: lv.noXpChannelIds.length ? lv.noXpChannelIds.map((c) => `<#${c}>`).join(" ") : "*none*", inline: false },
      { name: "No-XP roles", value: roleList(lv.noXpRoleIds), inline: false },
      { name: "Rewards / multipliers", value: `${Object.keys(lv.roleRewards).length} reward(s) · ${Object.keys(lv.multiplierRoles).length} multiplier(s)`, inline: false },
    ],
    footer: "Level-up message placeholders: {user} {level}",
  });
  components.push(
    new ActionRowBuilder().addComponents(
      toggleBtn("dset_toggle_leveling", "Enabled", lv.enabled),
      actionBtn("dset_lvl_values", "Edit XP values"),
      actionBtn("dset_open|leveling|announce", "Announcements"),
      actionBtn("dset_open|leveling|rewards", "Rewards"),
      actionBtn("dset_open|leveling|mult", "Multipliers")
    )
  );
  components.push(channelSelect("dset_lvl_noxp_channels", "No-XP channels…", lv.noXpChannelIds, { max: 25 }));
  components.push(roleSelect("dset_lvl_noxp_roles", "No-XP roles…", lv.noXpRoleIds));
  return embed;
}

function renderInvites(s, components) {
  const inv = s.invites;
  const rewards = Object.entries(inv.rewards || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const embed = makeEmbed({
    title: "📨 Invite tracking",
    color: "brand",
    description: `${onoff(inv.enabled)} · accounts younger than **${inv.fakeAccountAgeDays}d** count as fake`,
    fields: [
      { name: "Join log", value: chan(inv.joinLogChannelId), inline: true },
      { name: "Milestone rewards", value: rewards.map(([n, r]) => `${n} → <@&${r}>`).join("\n") || "*none*", inline: false },
    ],
  });
  components.push(new ActionRowBuilder().addComponents(toggleBtn("dset_toggle_invites", "Enabled", inv.enabled), actionBtn("dset_inv_fakedays", "Fake threshold")));
  components.push(channelSelect("dset_inv_joinlog", "Join-log channel…", inv.joinLogChannelId));
  components.push(roleSelect("dset_inv_reward_role", "Add a milestone reward role…", [], { max: 1 }));
  if (rewards.length)
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("dset_inv_delreward").setPlaceholder("Remove a milestone reward…").addOptions(rewards.map(([n, r]) => ({ label: `${n} invites`, value: n, description: `role ${r}` })))));
  return embed;
}

function renderStatistics(s, components) {
  const st = s.statistics;
  const embed = makeEmbed({
    title: "📊 Statistics / logging",
    color: "brand",
    description: `${onoff(st.enabled)} — counts joins/leaves/messages/voice and logs them to the channels below.`,
    fields: [
      { name: "Join/leave log", value: chan(st.logs.joinLeaveChannelId), inline: true },
      { name: "Message log", value: chan(st.logs.messageChannelId), inline: true },
      { name: "Voice log", value: chan(st.logs.voiceChannelId), inline: true },
    ],
  });
  components.push(new ActionRowBuilder().addComponents(toggleBtn("dset_toggle_statistics", "Enabled", st.enabled)));
  components.push(channelSelect("dset_stat_joinleave", "Join/leave log channel…", st.logs.joinLeaveChannelId));
  components.push(channelSelect("dset_stat_message", "Message (edit/delete) log channel…", st.logs.messageChannelId));
  components.push(channelSelect("dset_stat_voice", "Voice log channel…", st.logs.voiceChannelId));
  return embed;
}

function renderGiveaways(s, components) {
  const embed = makeEmbed({
    title: "🎉 Giveaways",
    color: "brand",
    description: "Host roles and entry emoji. Templates, bonus entries, and schedules are managed with `/giveaway`.",
    fields: [
      { name: "Host roles", value: roleList(s.giveaways.hostRoleIds), inline: false },
      { name: "Emoji", value: s.giveaways.emoji || "🎉", inline: true },
    ],
  });
  components.push(roleSelect("dset_gw_hostroles", "Select giveaway host roles…", s.giveaways.hostRoleIds));
  components.push(new ActionRowBuilder().addComponents(actionBtn("dset_gw_emoji", "Set entry emoji", "🎉")));
  return embed;
}

function renderClanAlliance(components, category, guildId) {
  if (category === "clan") {
    const clan = ca.getClanForGuild(guildId);
    if (!clan) {
      return makeEmbed({ title: "⚔️ Clan", color: "neutral", description: "This server isn't a registered clan. Register it with `/clan add` (Royalty only)." });
    }
    const embed = makeEmbed({
      title: `⚔️ ${clan.name} [${clan.abbr}]`,
      color: "brand",
      description: "Edit this clan — the same fields as `/clan edit`. (Flag and Yazanaki-side role stay in `/clan edit`.)",
      fields: [
        { name: "Name", value: clan.name, inline: true },
        { name: "Abbreviation", value: clan.abbr, inline: true },
        { name: "Application mode", value: clan.applicationMode || "manual", inline: true },
        { name: "Clan role (this server)", value: clan.clanRoleId ? `<@&${clan.clanRoleId}>` : "*not set*", inline: true },
        { name: "DonutSMP", value: clan.donutsmpTeamName ? `\`${clan.donutsmpTeamName}\`` : "*not linked*", inline: true },
        { name: "Invite", value: clan.invite || "*none*", inline: false },
      ],
    });
    components.push(new ActionRowBuilder().addComponents(actionBtn("dset_clan_edit", "Edit clan", "✏️")));
    components.push(roleSelect("dset_clan_role", "Clan member role (this server)…", clan.clanRoleId ? [clan.clanRoleId] : [], { max: 1 }));
    return embed;
  }
  const alli = ca.getAllianceForGuild(guildId);
  if (!alli) {
    return makeEmbed({ title: "🤝 Alliance", color: "neutral", description: "This server's clan isn't part of an alliance. Form one with `/alliance join` (Royalty only)." });
  }
  const embed = makeEmbed({
    title: `🤝 ${alli.name}`,
    color: "brand",
    description: "Edit this alliance's invite. (Name and flag stay in `/alliance join`.)",
    fields: [
      { name: "Clan", value: `${alli.clanName} [${alli.clanAbbr}]`, inline: true },
      { name: "Invite", value: alli.invite || "*none*", inline: false },
    ],
  });
  components.push(new ActionRowBuilder().addComponents(actionBtn("dset_alli_edit", "Edit alliance", "✏️")));
  return embed;
}

function renderBoosters(s, components) {
  const b = s.boosterRoles;
  const embed = makeEmbed({
    title: "💜 Booster roles",
    color: "brand",
    description: "Let boosters create their own role with `/boostrole`.",
    fields: [
      { name: "Enabled", value: onoff(b.enabled), inline: true },
      { name: "Remove on unboost", value: onoff(b.removeOnUnboost), inline: true },
      { name: "Allow gradient", value: onoff(b.allowGradient), inline: true },
      { name: "Allow icons", value: onoff(b.allowIcons), inline: true },
      { name: "Anchor role", value: b.anchorRoleId ? `<@&${b.anchorRoleId}>` : "*below my top role*", inline: true },
      { name: "Log channel", value: chan(b.logChannelId), inline: true },
      { name: "Multi-booster role", value: b.multiBoostRoleId ? `<@&${b.multiBoostRoleId}> at ${b.multiBoostThreshold}+ boosts` : "*not set*", inline: false },
    ],
    footer: "Multi-boost counts are tracked from boost messages while the bot runs; seed history with /boostrole setcount",
  });
  components.push(
    new ActionRowBuilder().addComponents(
      toggleBtn("dset_boost_toggle_enabled", "Enabled", b.enabled),
      toggleBtn("dset_boost_toggle_removeOnUnboost", "Remove on unboost", b.removeOnUnboost),
      toggleBtn("dset_boost_toggle_allowGradient", "Gradient", b.allowGradient),
      toggleBtn("dset_boost_toggle_allowIcons", "Icons", b.allowIcons),
      new ButtonBuilder().setCustomId("dset_boost_threshold").setLabel(`Threshold: ${b.multiBoostThreshold}`).setStyle(ButtonStyle.Primary)
    )
  );
  components.push(roleSelect("dset_boost_anchor", "Anchor role…", b.anchorRoleId ? [b.anchorRoleId] : [], { max: 1 }));
  components.push(roleSelect("dset_boost_multirole", "Multi-booster role…", b.multiBoostRoleId ? [b.multiBoostRoleId] : [], { max: 1 }));
  components.push(channelSelect("dset_boost_log", "Booster-role log channel…", b.logChannelId));
  return embed;
}

function renderOverview(s) {
  return makeEmbed({
    title: "🛠️ KenzAI Setup",
    color: "brand",
    description: "Pick a category below to configure the bot for this server. Everything is configured here — there are no separate config commands.",
    fields: [
      { name: "📜 Moderation logs", value: `Fallback: ${chan(s.moderation.modLogChannelId)}` },
      { name: "🤖 Automod", value: onoff(s.automod.enabled) },
      { name: "📈 Leveling", value: onoff(s.leveling.enabled) },
      { name: "📨 Invites", value: onoff(s.invites.enabled) },
      { name: "📊 Statistics", value: onoff(s.statistics.enabled) },
      { name: "💜 Booster roles", value: onoff(s.boosterRoles.enabled) },
    ],
  });
}

function render(guildId, category = "overview", ctx = {}) {
  const s = getGuildSettings(guildId);
  const components = [categoryRow(category)];
  let embed;
  switch (category) {
    case "moderation": embed = renderModeration(s, components, ctx); break;
    case "modroles": embed = renderModroles(s, components, ctx); break;
    case "automod": embed = renderAutomod(s, components, ctx); break;
    case "leveling": embed = renderLeveling(s, components, ctx); break;
    case "invites": embed = renderInvites(s, components); break;
    case "statistics": embed = renderStatistics(s, components); break;
    case "giveaways": embed = renderGiveaways(s, components); break;
    case "clan":
    case "alliance": embed = renderClanAlliance(components, category, guildId); break;
    case "boosters": embed = renderBoosters(s, components); break;
    default: embed = renderOverview(s); break;
  }
  return { embeds: [embed], components };
}

module.exports = { render, CATEGORIES, AM_RULES };

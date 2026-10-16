// modules/discord/setup/setup.js — /setup
// The single configuration surface for the whole Discord module. Posts an
// admin embed with a category dropdown and per-category controls; all "dset_"
// components are routed here from events/interactionCreate.js. Panels are built
// in panels.js; this file mutates per-guild settings and re-renders.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const { getGuildSettings, updateGuildSettings } = require("../settings/settingsStore");
const { render } = require("./panels");
const ca = require("./clanAlliance");

async function requireRoyalty(interaction) {
  if (await ca.isRoyalty(interaction.client, interaction.user.id)) return true;
  await interaction.reply({ content: "❌ You need the **Royalty** role in the Yazanaki Empire to edit clans/alliances.", ephemeral: true }).catch(() => {});
  return false;
}

// Split "base|param" customIds.
function parse(customId) {
  const [base, param] = customId.split("|");
  return { base, param };
}
function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}
function num(v, min, max) {
  const n = parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}
function buildModal(customId, title, fields) {
  const m = new ModalBuilder().setCustomId(customId).setTitle(title);
  for (const f of fields) {
    const ti = new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.style || TextInputStyle.Short).setRequired(f.required !== false);
    if (f.value != null) ti.setValue(String(f.value));
    if (f.max) ti.setMaxLength(f.max);
    if (f.placeholder) ti.setPlaceholder(f.placeholder);
    m.addComponents(new ActionRowBuilder().addComponents(ti));
  }
  return m;
}

// Threshold modal field definitions per automod rule.
function automodThreshFields(rule, r) {
  switch (rule) {
    case "antiSpam":
      return [
        { id: "maxMessages", label: "Max messages in window", value: r.maxMessages, max: 3 },
        { id: "intervalSeconds", label: "Window (seconds)", value: Math.round(r.intervalMs / 1000), max: 4 },
        { id: "muteSeconds", label: "Mute length if action=mute (seconds)", value: r.muteSeconds, max: 8 },
      ];
    case "antiMention":
      return [
        { id: "maxMentions", label: "Max mentions per message", value: r.maxMentions, max: 3 },
        { id: "muteSeconds", label: "Mute length if action=mute (seconds)", value: r.muteSeconds, max: 8 },
      ];
    case "antiCaps":
      return [
        { id: "minLength", label: "Ignore messages shorter than", value: r.minLength, max: 4 },
        { id: "percent", label: "Caps percentage that triggers (50-100)", value: r.percent, max: 3 },
      ];
    case "antiRaid":
      return [
        { id: "joinCount", label: "Joins that trigger a raid", value: r.joinCount, max: 4 },
        { id: "intervalSeconds", label: "Window (seconds)", value: Math.round(r.intervalMs / 1000), max: 4 },
      ];
    default:
      return [];
  }
}
function applyAutomodThresh(rule, r, fields) {
  const g = (id) => fields.getTextInputValue(id);
  if (rule === "antiSpam") {
    const a = num(g("maxMessages"), 2, 30), b = num(g("intervalSeconds"), 1, 60), c = num(g("muteSeconds"), 10, 2419200);
    if (a != null) r.maxMessages = a;
    if (b != null) r.intervalMs = b * 1000;
    if (c != null) r.muteSeconds = c;
  } else if (rule === "antiMention") {
    const a = num(g("maxMentions"), 1, 50), c = num(g("muteSeconds"), 10, 2419200);
    if (a != null) r.maxMentions = a;
    if (c != null) r.muteSeconds = c;
  } else if (rule === "antiCaps") {
    const a = num(g("minLength"), 4, 200), b = num(g("percent"), 50, 100);
    if (a != null) r.minLength = a;
    if (b != null) r.percent = b;
  } else if (rule === "antiRaid") {
    const a = num(g("joinCount"), 3, 100), b = num(g("intervalSeconds"), 2, 120);
    if (a != null) r.joinCount = a;
    if (b != null) r.intervalMs = b * 1000;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Open the KenzAI configuration dashboard")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) return interaction.reply({ content: "❌ Server only.", ephemeral: true });
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ You need the **Manage Server** permission.", ephemeral: true });
    const { embeds, components } = render(interaction.guildId, "overview");
    return interaction.reply({ embeds, components, ephemeral: true });
  },

  // ---- string select menus ----
  async selectMenuHandler(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const g = interaction.guildId;
    const { base, param } = parse(interaction.customId);
    const value = interaction.values[0];

    if (base === "dset_cat") return interaction.update(render(g, value));
    if (base === "dset_ml_action") return interaction.update(render(g, "moderation", { action: value }));
    if (base === "dset_mr_pickgroup") return interaction.update(render(g, "modroles", { group: value }));
    if (base === "dset_mr_pickcmd") return interaction.update(render(g, "modroles", { command: value }));
    if (base === "dset_mr_setcmdgroup") {
      updateGuildSettings(g, (s) => ((s.permissions.commandGroup[param] = value), s));
      return interaction.update(render(g, "modroles", { command: param }));
    }
    if (base === "dset_am_rule") return interaction.update(render(g, "automod", { rule: value }));
    if (base === "dset_am_action") {
      updateGuildSettings(g, (s) => ((s.automod[param].action = value), s));
      return interaction.update(render(g, "automod", { rule: param }));
    }
    if (base === "dset_lvl_announce_target") {
      updateGuildSettings(g, (s) => {
        if (value === "channel") s.leveling.announceTarget = "channel"; // channel id set via the picker below
        else s.leveling.announceTarget = value;
        return s;
      });
      return interaction.update(render(g, "leveling", { sub: "announce" }));
    }
    if (base === "dset_lvl_delreward") {
      updateGuildSettings(g, (s) => (delete s.leveling.roleRewards[value], s));
      return interaction.update(render(g, "leveling", { sub: "rewards" }));
    }
    if (base === "dset_lvl_delmult") {
      updateGuildSettings(g, (s) => (delete s.leveling.multiplierRoles[value], s));
      return interaction.update(render(g, "leveling", { sub: "mult" }));
    }
    if (base === "dset_inv_delreward") {
      updateGuildSettings(g, (s) => (delete s.invites.rewards[value], s));
      return interaction.update(render(g, "invites"));
    }
    return interaction.deferUpdate();
  },

  // ---- channel select menus ----
  async channelSelectHandler(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const g = interaction.guildId;
    const { base, param } = parse(interaction.customId);
    const one = interaction.values[0] || null;
    const many = interaction.values || [];

    // single-value channel settings: setter -> [category, ctx]
    const single = {
      dset_ml_fallback: [(s) => (s.moderation.modLogChannelId = one), "moderation", {}],
      dset_am_log: [(s) => (s.automod.logChannelId = one), "automod", {}],
      dset_lvl_announce_channel: [(s) => (s.leveling.announceTarget = one || "current"), "leveling", { sub: "announce" }],
      dset_inv_joinlog: [(s) => (s.invites.joinLogChannelId = one), "invites", {}],
      dset_stat_joinleave: [(s) => (s.statistics.logs.joinLeaveChannelId = one), "statistics", {}],
      dset_stat_message: [(s) => (s.statistics.logs.messageChannelId = one), "statistics", {}],
      dset_stat_voice: [(s) => (s.statistics.logs.voiceChannelId = one), "statistics", {}],
      dset_boost_log: [(s) => (s.boosterRoles.logChannelId = one), "boosters", {}],
    };

    if (base === "dset_ml_chan") {
      updateGuildSettings(g, (s) => ((s.moderation.logs[param] = one), s));
      return interaction.update(render(g, "moderation", { action: param }));
    }
    if (base === "dset_am_exempt_channels") {
      updateGuildSettings(g, (s) => ((s.automod.exemptChannelIds = many), s));
      return interaction.update(render(g, "automod", { sub: "exempt" }));
    }
    if (base === "dset_lvl_noxp_channels") {
      updateGuildSettings(g, (s) => ((s.leveling.noXpChannelIds = many), s));
      return interaction.update(render(g, "leveling"));
    }
    if (single[base]) {
      const [setter, cat, ctx] = single[base];
      updateGuildSettings(g, (s) => (setter(s), s));
      return interaction.update(render(g, cat, ctx));
    }
    return interaction.deferUpdate();
  },

  // ---- role select menus ----
  async roleSelectHandler(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const g = interaction.guildId;
    const { base, param } = parse(interaction.customId);
    const many = interaction.values || [];
    const one = interaction.values[0] || null;

    // Role selects that open a modal to capture a number (level/factor/count).
    if (base === "dset_lvl_reward_role") {
      if (!one) return interaction.deferUpdate();
      return interaction.showModal(buildModal(`dset_lvl_reward_level|${one}`, "Level reward", [{ id: "level", label: "Level this role is granted at", max: 4 }]));
    }
    if (base === "dset_lvl_mult_role") {
      if (!one) return interaction.deferUpdate();
      return interaction.showModal(buildModal(`dset_lvl_mult_factor|${one}`, "XP multiplier", [{ id: "factor", label: "Multiplier (2-10, or 0 to remove)", max: 2 }]));
    }
    if (base === "dset_inv_reward_role") {
      if (!one) return interaction.deferUpdate();
      return interaction.showModal(buildModal(`dset_inv_reward_count|${one}`, "Invite reward", [{ id: "count", label: "Invites required for this role", max: 5 }]));
    }

    const multi = {
      dset_gw_hostroles: [(s) => (s.giveaways.hostRoleIds = many), "giveaways", {}],
      dset_am_exempt_roles: [(s) => (s.automod.exemptRoleIds = many), "automod", { sub: "exempt" }],
      dset_lvl_noxp_roles: [(s) => (s.leveling.noXpRoleIds = many), "leveling", {}],
    };
    const singleRole = {
      dset_boost_anchor: [(s) => (s.boosterRoles.anchorRoleId = one), "boosters", {}],
      dset_boost_multirole: [(s) => (s.boosterRoles.multiBoostRoleId = one), "boosters", {}],
    };

    if (base === "dset_mr_setroles") {
      updateGuildSettings(g, (s) => ((s.permissions.groups[param] = many), s));
      return interaction.update(render(g, "modroles", { group: param }));
    }
    if (base === "dset_clan_role") {
      if (!(await requireRoyalty(interaction))) return;
      ca.setClanRole(g, one);
      return interaction.update(render(g, "clan"));
    }
    if (multi[base]) {
      const [setter, cat, ctx] = multi[base];
      updateGuildSettings(g, (s) => (setter(s), s));
      return interaction.update(render(g, cat, ctx));
    }
    if (singleRole[base]) {
      const [setter, cat, ctx] = singleRole[base];
      updateGuildSettings(g, (s) => (setter(s), s));
      return interaction.update(render(g, cat, ctx));
    }
    return interaction.deferUpdate();
  },

  // ---- buttons ----
  async buttonHandler(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const g = interaction.guildId;
    const id = interaction.customId;
    const { base, param } = parse(id);

    // Navigation: dset_open|<category>|<sub>
    if (base === "dset_open") {
      const [, category, sub] = id.split("|");
      return interaction.update(render(g, category, sub ? { sub } : {}));
    }

    // Feature enable toggles (leveling/invites/statistics).
    if (id.startsWith("dset_toggle_")) {
      const feature = id.slice("dset_toggle_".length);
      updateGuildSettings(g, (s) => (s[feature] && (s[feature].enabled = !s[feature].enabled), s));
      return interaction.update(render(g, feature));
    }
    if (id === "dset_mod_dm") {
      updateGuildSettings(g, (s) => ((s.moderation.dmOnAction = !s.moderation.dmOnAction), s));
      return interaction.update(render(g, "moderation"));
    }
    if (id === "dset_am_enabled") {
      updateGuildSettings(g, (s) => ((s.automod.enabled = !s.automod.enabled), s));
      return interaction.update(render(g, "automod"));
    }
    if (base === "dset_am_ruletoggle") {
      updateGuildSettings(g, (s) => ((s.automod[param].enabled = !s.automod[param].enabled), s));
      return interaction.update(render(g, "automod", { rule: param }));
    }
    if (base === "dset_am_thresh") {
      const r = getGuildSettings(g).automod[param];
      return interaction.showModal(buildModal(`dset_am_thresh_modal|${param}`, `Edit ${param}`, automodThreshFields(param, r)));
    }
    if (id === "dset_am_words") {
      const words = getGuildSettings(g).automod.wordFilter.words || [];
      return interaction.showModal(buildModal("dset_am_words_modal", "Blocked words", [{ id: "words", label: "Comma-separated blocked words/phrases", style: TextInputStyle.Paragraph, value: words.join(", "), required: false, max: 1000 }]));
    }
    if (id === "dset_lvl_values") {
      const lv = getGuildSettings(g).leveling;
      return interaction.showModal(
        buildModal("dset_lvl_values_modal", "Leveling XP values", [
          { id: "xpMin", label: "Min XP per message", value: lv.xpPerMessageMin, max: 3 },
          { id: "xpMax", label: "Max XP per message", value: lv.xpPerMessageMax, max: 3 },
          { id: "cooldown", label: "Cooldown between XP messages (seconds)", value: lv.messageCooldownSeconds, max: 4 },
          { id: "voiceXp", label: "Voice XP per minute", value: lv.voiceXpPerMinute, max: 3 },
        ])
      );
    }
    if (id === "dset_lvl_announce_toggle") {
      updateGuildSettings(g, (s) => ((s.leveling.announceLevelUp = !s.leveling.announceLevelUp), s));
      return interaction.update(render(g, "leveling", { sub: "announce" }));
    }
    if (id === "dset_lvl_announce_msg") {
      const lv = getGuildSettings(g).leveling;
      return interaction.showModal(buildModal("dset_lvl_announce_msg_modal", "Level-up message", [{ id: "msg", label: "Message ({user} {level})", style: TextInputStyle.Paragraph, value: lv.levelUpMessage, max: 300 }]));
    }
    if (id === "dset_lvl_stack") {
      updateGuildSettings(g, (s) => ((s.leveling.stackRewards = !s.leveling.stackRewards), s));
      return interaction.update(render(g, "leveling", { sub: "rewards" }));
    }
    if (id === "dset_inv_fakedays") {
      const inv = getGuildSettings(g).invites;
      return interaction.showModal(buildModal("dset_inv_fakedays_modal", "Fake-account threshold", [{ id: "days", label: "Account age in days below which = fake", value: inv.fakeAccountAgeDays, max: 3 }]));
    }
    if (id === "dset_gw_emoji") {
      return interaction.showModal(buildModal("dset_gw_emoji_modal", "Giveaway entry emoji", [{ id: "emoji", label: "A single standard emoji", value: getGuildSettings(g).giveaways.emoji, max: 8 }]));
    }
    if (id.startsWith("dset_boost_toggle_")) {
      const key = id.slice("dset_boost_toggle_".length);
      updateGuildSettings(g, (s) => ((s.boosterRoles[key] = !s.boosterRoles[key]), s));
      return interaction.update(render(g, "boosters"));
    }
    if (id === "dset_boost_threshold") {
      return interaction.showModal(buildModal("dset_boost_threshold_modal", "Multi-booster threshold", [{ id: "threshold", label: "Boosts required for the role", value: getGuildSettings(g).boosterRoles.multiBoostThreshold, max: 3 }]));
    }
    if (id === "dset_clan_edit") {
      if (!(await requireRoyalty(interaction))) return;
      const clan = ca.getClanForGuild(g);
      if (!clan) return interaction.reply({ content: "This server isn't a registered clan.", ephemeral: true });
      return interaction.showModal(
        buildModal("dset_clan_edit_modal", "Edit clan", [
          { id: "name", label: "Name", value: clan.name, required: false, max: 100 },
          { id: "abbreviation", label: "Abbreviation", value: clan.abbr, required: false, max: 10 },
          { id: "applicationMode", label: "Application mode (manual/automatic)", value: clan.applicationMode || "manual", required: false, max: 10 },
          { id: "server", label: "Server (donutsmp / clear)", value: clan.donutsmpTeamName ? "donutsmp" : "", required: false, max: 20 },
        ])
      );
    }
    if (id === "dset_alli_edit") {
      if (!(await requireRoyalty(interaction))) return;
      const alli = ca.getAllianceForGuild(g);
      if (!alli) return interaction.reply({ content: "This server's clan isn't part of an alliance.", ephemeral: true });
      return interaction.showModal(buildModal("dset_alli_edit_modal", "Edit alliance", [{ id: "invite", label: "Discord invite link", value: alli.invite || "", required: false, max: 100 }]));
    }
    return interaction.deferUpdate();
  },

  // ---- modals ----
  async modalHandler(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const g = interaction.guildId;
    const { base, param } = parse(interaction.customId);
    const f = interaction.fields;

    if (interaction.customId === "dset_gw_emoji_modal") {
      updateGuildSettings(g, (s) => ((s.giveaways.emoji = f.getTextInputValue("emoji").trim() || "🎉"), s));
      return interaction.update(render(g, "giveaways"));
    }
    if (interaction.customId === "dset_boost_threshold_modal") {
      const n = num(f.getTextInputValue("threshold"), 1, 100);
      if (n != null) updateGuildSettings(g, (s) => ((s.boosterRoles.multiBoostThreshold = n), s));
      return interaction.update(render(g, "boosters"));
    }
    if (interaction.customId === "dset_lvl_values_modal") {
      updateGuildSettings(g, (s) => {
        const lv = s.leveling;
        const mn = num(f.getTextInputValue("xpMin"), 0, 500), mx = num(f.getTextInputValue("xpMax"), 0, 500);
        const cd = num(f.getTextInputValue("cooldown"), 0, 3600), vx = num(f.getTextInputValue("voiceXp"), 0, 500);
        if (mn != null) lv.xpPerMessageMin = mn;
        if (mx != null) lv.xpPerMessageMax = Math.max(mx, lv.xpPerMessageMin);
        if (cd != null) lv.messageCooldownSeconds = cd;
        if (vx != null) lv.voiceXpPerMinute = vx;
        return s;
      });
      return interaction.update(render(g, "leveling"));
    }
    if (interaction.customId === "dset_lvl_announce_msg_modal") {
      updateGuildSettings(g, (s) => ((s.leveling.levelUpMessage = f.getTextInputValue("msg").slice(0, 300) || s.leveling.levelUpMessage), s));
      return interaction.update(render(g, "leveling", { sub: "announce" }));
    }
    if (base === "dset_lvl_reward_level") {
      const level = num(f.getTextInputValue("level"), 1, 1000);
      if (level != null) updateGuildSettings(g, (s) => ((s.leveling.roleRewards[String(level)] = param), s));
      return interaction.update(render(g, "leveling", { sub: "rewards" }));
    }
    if (base === "dset_lvl_mult_factor") {
      const factor = num(f.getTextInputValue("factor"), 0, 10);
      updateGuildSettings(g, (s) => {
        if (factor == null || factor <= 1) delete s.leveling.multiplierRoles[param];
        else s.leveling.multiplierRoles[param] = factor;
        return s;
      });
      return interaction.update(render(g, "leveling", { sub: "mult" }));
    }
    if (interaction.customId === "dset_inv_fakedays_modal") {
      const d = num(f.getTextInputValue("days"), 0, 365);
      if (d != null) updateGuildSettings(g, (s) => ((s.invites.fakeAccountAgeDays = d), s));
      return interaction.update(render(g, "invites"));
    }
    if (base === "dset_inv_reward_count") {
      const count = num(f.getTextInputValue("count"), 1, 100000);
      if (count != null) updateGuildSettings(g, (s) => ((s.invites.rewards[String(count)] = param), s));
      return interaction.update(render(g, "invites"));
    }
    if (base === "dset_am_thresh_modal") {
      updateGuildSettings(g, (s) => (applyAutomodThresh(param, s.automod[param], f), s));
      return interaction.update(render(g, "automod", { rule: param }));
    }
    if (interaction.customId === "dset_am_words_modal") {
      const words = f.getTextInputValue("words").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
      updateGuildSettings(g, (s) => ((s.automod.wordFilter.words = [...new Set(words)]), s));
      return interaction.update(render(g, "automod", { rule: "wordFilter" }));
    }
    if (interaction.customId === "dset_clan_edit_modal") {
      if (!(await requireRoyalty(interaction))) return;
      ca.applyClanEdit(g, {
        name: f.getTextInputValue("name"),
        abbreviation: f.getTextInputValue("abbreviation"),
        applicationMode: f.getTextInputValue("applicationMode").trim().toLowerCase(),
        server: f.getTextInputValue("server"),
      });
      return interaction.update(render(g, "clan"));
    }
    if (interaction.customId === "dset_alli_edit_modal") {
      if (!(await requireRoyalty(interaction))) return;
      ca.applyAllianceEdit(g, { invite: f.getTextInputValue("invite") });
      return interaction.update(render(g, "alliance"));
    }
    return interaction.deferUpdate();
  },
};

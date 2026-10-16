// modules/discord/giveaways/giveaway.js — /giveaway
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const store = require("./giveawayStore");
const logic = require("./giveawaylogic");
const templates = require("./templates/templates");
const scheduleStore = require("./scheduling/scheduleStore");
const { getGuildSettings } = require("../settings/settingsStore");
const { canUse } = require("../common/commandGuard");
const { makeEmbed, success, danger } = require("../common/embeds");
const { parseDuration, formatDuration } = require("../common/util");

const MAX_DURATION_MS = 60 * 86400 * 1000; // 60 days
const MAX_START_DELAY_MS = 60 * 86400 * 1000; // schedule up to 60 days out
const MIN_INTERVAL_MS = 30 * 60 * 1000; // recurring giveaways: min 30 minutes

// Who may run /giveaway: the "giveawayHost" permission group governs when
// configured (via /setup), otherwise fall back to Manage Server OR a legacy
// giveaways.hostRoleIds entry.
function canHost(member, settings) {
  const builtin = (m) =>
    m.permissions.has(PermissionFlagsBits.ManageGuild) ||
    (settings.giveaways.hostRoleIds || []).some((r) => m.roles.cache.has(r));
  return canUse(member, "giveaway", builtin, settings);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create and manage giveaways")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Create a giveaway (optionally scheduled to start later)")
        .addStringOption((o) => o.setName("prize").setDescription("What's being given away"))
        .addStringOption((o) => o.setName("duration").setDescription("How long it runs, e.g. 1h, 2d, 30m"))
        .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners (default 1)").setMinValue(1).setMaxValue(50))
        .addChannelOption((o) => o.setName("channel").setDescription("Channel to post in (default: here)").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice))
        .addStringOption((o) => o.setName("starts-in").setDescription("Delay before it begins, e.g. 2h, 1d (default: immediately)"))
        .addRoleOption((o) => o.setName("required-role").setDescription("Role required to enter"))
        .addIntegerOption((o) => o.setName("required-level").setDescription("Minimum level required to enter").setMinValue(1))
        .addStringOption((o) => o.setName("bonus-roles").setDescription("Bonus entries per role: @role amount @role amount — e.g. @VIP 2 @Booster 3"))
        .addStringOption((o) => o.setName("template").setDescription("Load a saved template as the base"))
    )
    .addSubcommand((s) =>
      s.setName("end").setDescription("End a giveaway now").addStringOption((o) => o.setName("message-id").setDescription("Giveaway message ID").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("reroll")
        .setDescription("Reroll winners for an ended giveaway")
        .addStringOption((o) => o.setName("message-id").setDescription("Giveaway message ID").setRequired(true))
        .addIntegerOption((o) => o.setName("winners").setDescription("How many new winners").setMinValue(1).setMaxValue(50))
    )
    .addSubcommand((s) => s.setName("list").setDescription("List active giveaways"))
    .addSubcommandGroup((g) =>
      g
        .setName("schedule")
        .setDescription("Recurring giveaways that auto-launch from a template")
        .addSubcommand((s) =>
          s
            .setName("create")
            .setDescription("Auto-launch a template's giveaway on a repeating interval")
            .addStringOption((o) => o.setName("template").setDescription("Saved template to launch each time").setRequired(true))
            .addStringOption((o) => o.setName("every").setDescription("Interval, e.g. 1d, 12h, 7d (min 30m)").setRequired(true))
            .addChannelOption((o) => o.setName("channel").setDescription("Channel to post in").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice))
            .addBooleanOption((o) => o.setName("start-now").setDescription("Also launch one immediately (default: after the first interval)"))
        )
        .addSubcommand((s) => s.setName("list").setDescription("List recurring giveaway schedules"))
        .addSubcommand((s) =>
          s.setName("delete").setDescription("Delete a recurring schedule").addStringOption((o) => o.setName("id").setDescription("Schedule ID").setRequired(true))
        )
        .addSubcommand((s) =>
          s.setName("toggle").setDescription("Pause/resume a recurring schedule").addStringOption((o) => o.setName("id").setDescription("Schedule ID").setRequired(true))
        )
    )
    .addSubcommandGroup((g) =>
      g
        .setName("template")
        .setDescription("Manage reusable giveaway templates")
        .addSubcommand((s) =>
          s
            .setName("save")
            .setDescription("Save a giveaway template")
            .addStringOption((o) => o.setName("name").setDescription("Template name").setRequired(true))
            .addStringOption((o) => o.setName("prize").setDescription("Prize").setRequired(true))
            .addStringOption((o) => o.setName("duration").setDescription("Duration, e.g. 1d").setRequired(true))
            .addIntegerOption((o) => o.setName("winners").setDescription("Winners (default 1)").setMinValue(1).setMaxValue(50))
            .addRoleOption((o) => o.setName("required-role").setDescription("Required role"))
            .addIntegerOption((o) => o.setName("required-level").setDescription("Required level").setMinValue(1))
        )
        .addSubcommand((s) => s.setName("list").setDescription("List saved templates"))
        .addSubcommand((s) =>
          s.setName("delete").setDescription("Delete a template").addStringOption((o) => o.setName("name").setDescription("Template name").setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName("bonus")
            .setDescription("Add/remove a bonus-entry role on a template")
            .addStringOption((o) => o.setName("name").setDescription("Template name").setRequired(true))
            .addRoleOption((o) => o.setName("role").setDescription("Role to grant bonus entries").setRequired(true))
            .addIntegerOption((o) => o.setName("entries").setDescription("Extra entries (0 removes)").setRequired(true).setMinValue(0).setMaxValue(100))
        )
    ),

  async execute(interaction) {
    const settings = getGuildSettings(interaction.guildId);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!canHost(interaction.member, settings))
      return interaction.reply({ embeds: [danger("You need **Manage Server** or a configured giveaway-host role.")], ephemeral: true });

    // ----- schedule group (recurring giveaways) -----
    if (group === "schedule") {
      if (sub === "create") {
        const templateName = interaction.options.getString("template");
        const tpl = templates.get(interaction.guildId, templateName);
        if (!tpl) return interaction.reply({ embeds: [danger(`No template named **${templateName}**. Create one with \`/giveaway template save\`.`)], ephemeral: true });
        const intervalMs = parseDuration(interaction.options.getString("every"));
        if (!intervalMs) return interaction.reply({ embeds: [danger("Invalid interval (try `12h`, `1d`, `7d`).")], ephemeral: true });
        if (intervalMs < MIN_INTERVAL_MS) return interaction.reply({ embeds: [danger("The interval must be at least **30 minutes**.")], ephemeral: true });
        const channel = interaction.options.getChannel("channel");
        const startNow = interaction.options.getBoolean("start-now") || false;
        const nextRunAt = new Date(Date.now() + (startNow ? 0 : intervalMs)).toISOString();
        const rec = scheduleStore.create({
          guildId: interaction.guildId,
          channelId: channel.id,
          templateName,
          intervalMs,
          nextRunAt,
          hostId: interaction.user.id,
        });
        return interaction.reply({
          embeds: [success(`Recurring giveaway created (\`${rec.scheduleId}\`): **${tpl.prize}** in ${channel} every **${formatDuration(intervalMs)}**. Next: <t:${Math.floor(Date.parse(nextRunAt) / 1000)}:R>.`)],
          ephemeral: true,
        });
      }
      if (sub === "list") {
        const list = scheduleStore.forGuild(interaction.guildId);
        if (!list.length) return interaction.reply({ embeds: [makeEmbed({ description: "No recurring giveaways. Create one with `/giveaway schedule create`." })], ephemeral: true });
        const lines = list.map(
          (r) => `\`${r.scheduleId}\` ${r.enabled ? "▶️" : "⏸️"} **${r.templateName}** in <#${r.channelId}> every ${formatDuration(r.intervalMs)} — next <t:${Math.floor(Date.parse(r.nextRunAt) / 1000)}:R>`
        );
        return interaction.reply({ embeds: [makeEmbed({ title: "🔁 Recurring giveaways", description: lines.join("\n") })], ephemeral: true });
      }
      if (sub === "delete") {
        const id = interaction.options.getString("id").trim();
        const rec = scheduleStore.get(id);
        if (!rec || rec.guildId !== interaction.guildId) return interaction.reply({ embeds: [danger("No schedule with that ID on this server.")], ephemeral: true });
        scheduleStore.remove(id);
        return interaction.reply({ embeds: [success(`Deleted recurring schedule \`${id}\`.`)], ephemeral: true });
      }
      if (sub === "toggle") {
        const id = interaction.options.getString("id").trim();
        const rec = scheduleStore.get(id);
        if (!rec || rec.guildId !== interaction.guildId) return interaction.reply({ embeds: [danger("No schedule with that ID on this server.")], ephemeral: true });
        rec.enabled = !rec.enabled;
        scheduleStore.save(rec);
        return interaction.reply({ embeds: [success(`Schedule \`${id}\` is now **${rec.enabled ? "active" : "paused"}**.`)], ephemeral: true });
      }
    }

    // ----- template group -----
    if (group === "template") {
      if (sub === "save") {
        const name = interaction.options.getString("name");
        const durationMs = parseDuration(interaction.options.getString("duration"));
        if (!durationMs) return interaction.reply({ embeds: [danger("Invalid duration.")], ephemeral: true });
        const existing = templates.get(interaction.guildId, name);
        templates.save(interaction.guildId, name, {
          prize: interaction.options.getString("prize"),
          winnerCount: interaction.options.getInteger("winners") || 1,
          durationMs,
          requiredRoleId: interaction.options.getRole("required-role")?.id || null,
          requiredLevel: interaction.options.getInteger("required-level") || 0,
          bonusEntries: existing?.bonusEntries || {}, // preserve configured bonus roles
        });
        return interaction.reply({ embeds: [success(`Saved template **${name}**.`)], ephemeral: true });
      }
      if (sub === "bonus") {
        const name = interaction.options.getString("name");
        const tpl = templates.get(interaction.guildId, name);
        if (!tpl) return interaction.reply({ embeds: [danger(`No template named **${name}**.`)], ephemeral: true });
        const role = interaction.options.getRole("role");
        const entries = interaction.options.getInteger("entries");
        const bonusEntries = { ...(tpl.bonusEntries || {}) };
        if (entries === 0) delete bonusEntries[role.id];
        else bonusEntries[role.id] = entries;
        templates.save(interaction.guildId, name, {
          prize: tpl.prize,
          winnerCount: tpl.winnerCount,
          durationMs: tpl.durationMs,
          requiredRoleId: tpl.requiredRoleId,
          requiredLevel: tpl.requiredLevel,
          bonusEntries,
        });
        const list = Object.entries(bonusEntries).map(([r, n]) => `<@&${r}>: +${n}`).join("\n") || "*none*";
        return interaction.reply({ embeds: [success(`Bonus entries for **${name}**:\n${list}`)], ephemeral: true });
      }
      if (sub === "list") {
        const list = templates.list(interaction.guildId);
        if (!list.length) return interaction.reply({ embeds: [makeEmbed({ description: "No templates saved." })], ephemeral: true });
        const lines = list.map((t) => `• **${t.name}** — ${t.prize}, ${t.winnerCount}w, ${formatDuration(t.durationMs)}`);
        return interaction.reply({ embeds: [makeEmbed({ title: "🎁 Giveaway templates", description: lines.join("\n") })], ephemeral: true });
      }
      if (sub === "delete") {
        const name = interaction.options.getString("name");
        const ok = templates.remove(interaction.guildId, name);
        return interaction.reply({ embeds: [ok ? success(`Deleted template **${name}**.`) : danger("No such template.")], ephemeral: true });
      }
    }

    // ----- create -----
    if (sub === "create") {
      let base = {};
      const tplName = interaction.options.getString("template");
      if (tplName) {
        const tpl = templates.get(interaction.guildId, tplName);
        if (!tpl) return interaction.reply({ embeds: [danger(`No template named **${tplName}**.`)], ephemeral: true });
        base = tpl;
      }

      const prize = interaction.options.getString("prize") || base.prize;
      const durationRaw = interaction.options.getString("duration");
      const durationMs = durationRaw ? parseDuration(durationRaw) : base.durationMs;
      const winnerCount = interaction.options.getInteger("winners") || base.winnerCount || 1;
      const channel = interaction.options.getChannel("channel") || interaction.channel;
      const requiredRoleId = interaction.options.getRole("required-role")?.id ?? base.requiredRoleId ?? null;
      const requiredLevel = interaction.options.getInteger("required-level") ?? base.requiredLevel ?? 0;

      // Snapshot bonus entries: from the template (if any) + this command's option.
      // Bonus entries: from the template (if any) + this command's "@role n @role n" field.
      const bonusEntries = { ...(base.bonusEntries || {}), ...logic.parseBonusRoles(interaction.options.getString("bonus-roles")) };

      const startsInRaw = interaction.options.getString("starts-in");
      const startDelayMs = startsInRaw ? parseDuration(startsInRaw) : 0;

      if (!prize) return interaction.reply({ embeds: [danger("A prize is required (provide `prize` or a template).")], ephemeral: true });
      if (!durationMs) return interaction.reply({ embeds: [danger("A valid duration is required (e.g. `1h`, `2d`).")], ephemeral: true });
      if (durationMs > MAX_DURATION_MS) return interaction.reply({ embeds: [danger("Giveaways can last at most **60 days**.")], ephemeral: true });
      if (startsInRaw && startDelayMs === null) return interaction.reply({ embeds: [danger("Invalid `starts-in` (try `2h`, `1d`).")], ephemeral: true });
      if (startDelayMs > MAX_START_DELAY_MS) return interaction.reply({ embeds: [danger("Giveaways can be scheduled at most **60 days** in advance.")], ephemeral: true });

      const scheduled = startDelayMs > 0;
      const startsAt = new Date(Date.now() + startDelayMs).toISOString();

      const record = {
        messageId: null,
        guildId: interaction.guildId,
        channelId: channel.id,
        prize,
        winnerCount,
        hostId: interaction.user.id,
        durationMs, // used to compute endsAt (now, or at activation for scheduled)
        startsAt,
        endsAt: scheduled ? null : new Date(Date.now() + durationMs).toISOString(),
        status: scheduled ? "scheduled" : "active",
        entries: [],
        requiredRoleId,
        requiredLevel,
        bonusEntries,
        winnerIds: [],
        createdAt: new Date().toISOString(),
      };

      try {
        const msg = await channel.send({ embeds: [logic.buildEmbed(record)] });
        record.messageId = msg.id;
        // Entry button is disabled while scheduled; the scheduler enables it on start.
        await msg.edit({ embeds: [logic.buildEmbed(record)], components: [logic.buildRow(msg.id, { disabled: scheduled })] });
        store.save(record);
        const when = scheduled
          ? `starts <t:${Math.floor(Date.parse(startsAt) / 1000)}:R> and runs for ${formatDuration(durationMs)}`
          : `ends in ${formatDuration(durationMs)}`;
        return interaction.reply({ embeds: [success(`Giveaway for **${prize}** created in ${channel} — ${when}.`)], ephemeral: true });
      } catch (err) {
        return interaction.reply({ embeds: [danger(`Couldn't create the giveaway: ${err.message}`)], ephemeral: true });
      }
    }

    // ----- end -----
    if (sub === "end") {
      const id = interaction.options.getString("message-id").trim();
      const record = store.get(id);
      if (!record) return interaction.reply({ embeds: [danger("No giveaway with that message ID.")], ephemeral: true });
      if (record.status !== "active") return interaction.reply({ embeds: [danger("That giveaway has already ended.")], ephemeral: true });
      await logic.endGiveaway(interaction.client, record);
      return interaction.reply({ embeds: [success("Giveaway ended.")], ephemeral: true });
    }

    // ----- reroll -----
    if (sub === "reroll") {
      const id = interaction.options.getString("message-id").trim();
      const count = interaction.options.getInteger("winners");
      const record = store.get(id);
      if (!record) return interaction.reply({ embeds: [danger("No giveaway with that message ID.")], ephemeral: true });
      if (record.status === "active") return interaction.reply({ embeds: [danger("End the giveaway before rerolling.")], ephemeral: true });
      const res = await logic.rerollGiveaway(interaction.client, record, count);
      return interaction.reply({ embeds: [res.ok ? success("Rerolled.") : danger(res.reason)], ephemeral: true });
    }

    // ----- list -----
    if (sub === "list") {
      const list = store.activeForGuild(interaction.guildId);
      if (!list.length) return interaction.reply({ embeds: [makeEmbed({ description: "No active giveaways." })], ephemeral: true });
      const lines = list.map(
        (g) => `• **${g.prize}** — ${g.entries.length} entries, ends <t:${Math.floor(new Date(g.endsAt).getTime() / 1000)}:R> (\`${g.messageId}\`)`
      );
      return interaction.reply({ embeds: [makeEmbed({ title: "🎉 Active giveaways", description: lines.join("\n") })], ephemeral: true });
    }
  },

  // Entry button: dgw_enter_<messageId>
  async buttonHandler(interaction) {
    if (!interaction.customId.startsWith("dgw_enter_")) return;
    const messageId = interaction.customId.slice("dgw_enter_".length);
    const record = store.get(messageId);
    if (!record || record.status !== "active")
      return interaction.reply({ content: "This giveaway is no longer active.", ephemeral: true });

    const check = logic.meetsRequirements(interaction.member, record);
    if (!check.ok) return interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });

    const idx = record.entries.indexOf(interaction.user.id);
    let msg;
    if (idx === -1) {
      record.entries.push(interaction.user.id);
      const weight = logic.entryWeight(interaction.member, record.bonusEntries);
      msg = weight > 1
        ? `✅ You've entered with **${weight}** entries (bonus applied)! Click again to leave.`
        : "✅ You've entered the giveaway! Click again to leave.";
    } else {
      record.entries.splice(idx, 1);
      msg = "You've left the giveaway.";
    }
    store.save(record);

    // Refresh the entry count on the message (best effort).
    try {
      await interaction.message.edit({ embeds: [logic.buildEmbed(record)], components: [logic.buildRow(messageId)] });
    } catch {
      /* ignore */
    }
    return interaction.reply({ content: msg, ephemeral: true });
  },
};

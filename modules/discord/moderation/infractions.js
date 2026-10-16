// modules/discord/moderation/infractions.js — /infractions view|remove|clear
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { canModerateMembers } = require("../common/perms");
const { authorize } = require("../common/commandGuard");
const infractions = require("./infractionsStore");
const { makeEmbed, danger, success } = require("../common/embeds");
const { formatDuration } = require("../common/util");

const ACTION_EMOJI = { warn: "⚠️", mute: "🔇", unmute: "🔊", kick: "👢", ban: "🔨", softban: "🧹", unban: "♻️", automod: "🤖" };

module.exports = {
  data: new SlashCommandBuilder()
    .setName("infractions")
    .setDescription("View or manage a member's moderation history")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s.setName("view").setDescription("View a member's infractions").addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a single infraction by its case number")
        .addIntegerOption((o) => o.setName("case").setDescription("Case number").setRequired(true).setMinValue(1))
    )
    .addSubcommand((s) =>
      s.setName("clear").setDescription("Clear ALL infractions for a member").addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    ),

  async execute(interaction) {
    if (!(await authorize(interaction, "infractions", canModerateMembers))) return;

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "view") {
      const user = interaction.options.getUser("user");
      const list = infractions.forUser(guildId, user.id);
      if (!list.length)
        return interaction.reply({ embeds: [makeEmbed({ color: "success", description: `✅ ${user.tag} has no infractions.` })], ephemeral: true });

      const lines = list.slice(0, 15).map((r) => {
        const dur = r.durationMs ? ` (${formatDuration(r.durationMs)})` : "";
        const when = `<t:${Math.floor(new Date(r.createdAt).getTime() / 1000)}:R>`;
        return `**#${r.caseNumber}** ${ACTION_EMOJI[r.action] || "📝"} \`${r.action}\`${dur} — ${r.reason} • by <@${r.moderatorId}> ${when}`;
      });
      return interaction.reply({
        embeds: [
          makeEmbed({
            color: "warn",
            title: `📋 Infractions for ${user.tag} (${list.length})`,
            description: lines.join("\n"),
            footer: list.length > 15 ? `Showing 15 of ${list.length}` : undefined,
          }),
        ],
        ephemeral: true,
      });
    }

    if (sub === "remove") {
      const caseNumber = interaction.options.getInteger("case");
      const rec = infractions.forGuild(guildId).find((r) => r.caseNumber === caseNumber);
      if (!rec) return interaction.reply({ embeds: [danger(`No case **#${caseNumber}** found.`)], ephemeral: true });
      infractions.remove(rec.caseId);
      return interaction.reply({ embeds: [success(`Removed case **#${caseNumber}** (${rec.action} for <@${rec.userId}>).`)], ephemeral: true });
    }

    if (sub === "clear") {
      const user = interaction.options.getUser("user");
      const n = infractions.clearUser(guildId, user.id);
      return interaction.reply({ embeds: [success(`Cleared **${n}** infraction(s) for ${user.tag}.`)], ephemeral: true });
    }
  },
};

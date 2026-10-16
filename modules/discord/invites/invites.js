// modules/discord/invites/invites.js — /invites
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const inviteStore = require("./inviteStore");
const { getGuildSettings } = require("../settings/settingsStore");
const { makeEmbed, success, danger } = require("../common/embeds");
const { clamp } = require("../common/util");

const PAGE_SIZE = 10;

function buildBoard(guildId, page) {
  const all = inviteStore.leaderboard(guildId);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  page = clamp(page, 0, pages - 1);
  const slice = all.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const lines = slice.map((r, i) => `**#${page * PAGE_SIZE + i + 1}** <@${r.userId}> — **${inviteStore.net(r)}** invites *(${r.regular} joined, ${r.left} left, ${r.fake} fake, ${r.bonus} bonus)*`);
  const embed = makeEmbed({
    color: "brand",
    title: "📨 Invite Leaderboard",
    description: lines.join("\n") || "No invites tracked yet.",
    footer: `Page ${page + 1}/${pages}`,
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dinv_lb_${page - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`dinv_lb_${page + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
  );
  return { embed, components: pages > 1 ? [row] : [] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("invites")
    .setDescription("View invite counts and the invite leaderboard")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s.setName("view").setDescription("View a member's invites").addUserOption((o) => o.setName("user").setDescription("Member (default: you)"))
    )
    .addSubcommand((s) => s.setName("leaderboard").setDescription("Show the invite leaderboard"))
    .addSubcommand((s) =>
      s
        .setName("bonus")
        .setDescription("Add or remove bonus invites (staff)")
        .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("Amount (can be negative)").setRequired(true))
    )
    .addSubcommand((s) =>
      s.setName("reset").setDescription("Reset a member's invites (staff)").addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
    ),

  async execute(interaction) {
    if (!getGuildSettings(interaction.guildId).invites.enabled)
      return interaction.reply({ content: "Invite tracking is disabled. An admin can enable it in `/setup` → Invite tracking.", ephemeral: true });

    const sub = interaction.options.getSubcommand();

    if (sub === "view") {
      const user = interaction.options.getUser("user") || interaction.user;
      const r = inviteStore.get(interaction.guildId, user.id);
      return interaction.reply({
        embeds: [
          makeEmbed({
            color: "brand",
            title: `📨 Invites — ${user.username}`,
            description: `**${inviteStore.net(r)}** invites`,
            fields: [
              { name: "Joined", value: String(r.regular), inline: true },
              { name: "Left", value: String(r.left), inline: true },
              { name: "Fake", value: String(r.fake), inline: true },
              { name: "Bonus", value: String(r.bonus), inline: true },
            ],
          }),
        ],
      });
    }

    if (sub === "leaderboard") {
      const { embed, components } = buildBoard(interaction.guildId, 0);
      return interaction.reply({ embeds: [embed], components });
    }

    // staff-only from here
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return interaction.reply({ embeds: [danger("You need the **Manage Server** permission.")], ephemeral: true });

    if (sub === "bonus") {
      const user = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");
      inviteStore.addBonus(interaction.guildId, user.id, amount);
      const r = inviteStore.get(interaction.guildId, user.id);
      return interaction.reply({ embeds: [success(`${amount >= 0 ? "Added" : "Removed"} **${Math.abs(amount)}** bonus invite(s) for ${user.tag}. They now have **${inviteStore.net(r)}**.`)], ephemeral: true });
    }

    if (sub === "reset") {
      const user = interaction.options.getUser("user");
      inviteStore.mutate(interaction.guildId, user.id, (rec) => {
        rec.regular = 0;
        rec.fake = 0;
        rec.left = 0;
        rec.bonus = 0;
      });
      return interaction.reply({ embeds: [success(`Reset invites for ${user.tag}.`)], ephemeral: true });
    }
  },

  async buttonHandler(interaction) {
    // dinv_lb_<page>
    const page = Number(interaction.customId.split("_")[2]) || 0;
    const { embed, components } = buildBoard(interaction.guildId, page);
    return interaction.update({ embeds: [embed], components });
  },
};

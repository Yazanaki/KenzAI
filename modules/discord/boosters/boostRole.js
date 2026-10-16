// modules/discord/boosters/boostRole.js — /boostrole
// Lets a server booster create and manage one personal role (name, color,
// optional gradient 2nd color, emoji or image icon). Gated by boosterRoles
// settings; gradient/icon applied only where the guild supports them.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const { getGuildSettings } = require("../settings/settingsStore");
const boostStore = require("./boostRoleStore");
const boostCounts = require("./boostCountStore");
const { reconcileMultiBoost } = require("./boostEvents");
const { applyRoleStyle } = require("./roleStyle");
const { makeEmbed, success, danger, warn } = require("../common/embeds");

const ROLE_CAP = 240; // leave headroom under Discord's 250 hard limit

function isBooster(member) {
  return member.premiumSinceTimestamp != null;
}

async function positionRole(guild, role, anchorRoleId) {
  if (!anchorRoleId) return;
  const anchor = guild.roles.cache.get(anchorRoleId);
  if (!anchor) return;
  await role.setPosition(Math.max(1, anchor.position - 1)).catch(() => {});
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("boostrole")
    .setDescription("Boosters: create and manage your own custom role")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Create your personal booster role")
        .addStringOption((o) => o.setName("name").setDescription("Role name").setRequired(true))
        .addStringOption((o) => o.setName("color").setDescription("Hex color, e.g. #FF8800").setRequired(true))
        .addStringOption((o) => o.setName("gradient").setDescription("2nd hex for a gradient (if the server supports it)"))
        .addStringOption((o) => o.setName("emoji").setDescription("A standard emoji for the role icon"))
        .addAttachmentOption((o) => o.setName("image").setDescription("A custom image icon (overrides emoji)"))
    )
    .addSubcommand((s) =>
      s
        .setName("edit")
        .setDescription("Edit your booster role")
        .addStringOption((o) => o.setName("name").setDescription("New name"))
        .addStringOption((o) => o.setName("color").setDescription("New hex color"))
        .addStringOption((o) => o.setName("gradient").setDescription("2nd hex for a gradient"))
        .addStringOption((o) => o.setName("emoji").setDescription("Standard emoji icon"))
        .addAttachmentOption((o) => o.setName("image").setDescription("Custom image icon"))
    )
    .addSubcommand((s) => s.setName("delete").setDescription("Delete your booster role"))
    .addSubcommand((s) => s.setName("show").setDescription("Show your booster role"))
    .addSubcommand((s) =>
      s
        .setName("setcount")
        .setDescription("Staff: set a member's tracked boost count (for the multi-booster role)")
        .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
        .addIntegerOption((o) => o.setName("count").setDescription("Number of boosts").setRequired(true).setMinValue(0).setMaxValue(100))
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    const settings = getGuildSettings(guild.id).boosterRoles;
    const sub = interaction.options.getSubcommand();

    // Staff-only: seed/override a member's boost count and reconcile the role.
    if (sub === "setcount") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
        return interaction.reply({ embeds: [danger("You need the **Manage Server** permission.")], ephemeral: true });
      const user = interaction.options.getUser("user");
      const count = interaction.options.getInteger("count");
      boostCounts.set(guild.id, user.id, count);
      await reconcileMultiBoost(guild, user.id, settings);
      return interaction.reply({ embeds: [success(`Set ${user}'s boost count to **${count}**${settings.multiBoostRoleId ? ` (multi-booster role reconciled)` : ""}.`)], ephemeral: true });
    }

    if (!settings.enabled)
      return interaction.reply({ embeds: [danger("Booster roles aren't enabled on this server.")], ephemeral: true });
    if (settings.requireBoost && !isBooster(interaction.member))
      return interaction.reply({ embeds: [danger("This is a perk for **server boosters** 💜. Boost the server to unlock a custom role!")], ephemeral: true });
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles))
      return interaction.reply({ embeds: [danger("I need the **Manage Roles** permission to manage booster roles.")], ephemeral: true });

    const existing = boostStore.get(guild.id, interaction.user.id);

    // ---- show ----
    if (sub === "show") {
      if (!existing) return interaction.reply({ embeds: [makeEmbed({ description: "You don't have a booster role yet — use `/boostrole create`." })], ephemeral: true });
      const role = guild.roles.cache.get(existing.roleId);
      return interaction.reply({ embeds: [makeEmbed({ color: "brand", description: role ? `Your booster role: ${role} (\`${role.name}\`)` : "Your booster role no longer exists — use `/boostrole create`." })], ephemeral: true });
    }

    // ---- delete ----
    if (sub === "delete") {
      if (!existing) return interaction.reply({ embeds: [danger("You don't have a booster role.")], ephemeral: true });
      const role = guild.roles.cache.get(existing.roleId);
      if (role) await role.delete("Booster role deleted by owner").catch(() => {});
      boostStore.remove(guild.id, interaction.user.id);
      return interaction.reply({ embeds: [success("Your booster role has been deleted.")], ephemeral: true });
    }

    const style = {
      primaryHex: interaction.options.getString("color"),
      secondaryHex: interaction.options.getString("gradient"),
      emoji: interaction.options.getString("emoji"),
      iconUrl: interaction.options.getAttachment("image")?.url || null,
    };

    // ---- edit ----
    if (sub === "edit") {
      if (!existing) return interaction.reply({ embeds: [danger("You don't have a booster role yet — use `/boostrole create`.")], ephemeral: true });
      const role = guild.roles.cache.get(existing.roleId);
      if (!role) {
        boostStore.remove(guild.id, interaction.user.id);
        return interaction.reply({ embeds: [danger("Your booster role was deleted — run `/boostrole create` to make a new one.")], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const name = interaction.options.getString("name");
        if (name) await role.setName(name.slice(0, 100), "Booster role edit");
        const { warnings } = await applyRoleStyle(guild, role, style, settings);
        return interaction.editReply({ embeds: [warnings.length ? warn(`Updated ${role} with notes:\n• ${warnings.join("\n• ")}`) : success(`Updated ${role}.`)] });
      } catch (err) {
        return interaction.editReply({ embeds: [danger(`Couldn't edit the role: ${err.message}`)] });
      }
    }

    // ---- create ----
    if (sub === "create") {
      if (existing && guild.roles.cache.get(existing.roleId))
        return interaction.reply({ embeds: [danger("You already have a booster role — use `/boostrole edit` or `/boostrole delete`.")], ephemeral: true });
      if (guild.roles.cache.size >= ROLE_CAP)
        return interaction.reply({ embeds: [danger("This server is at its role limit — an admin needs to free up some roles.")], ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      try {
        const role = await guild.roles.create({
          name: interaction.options.getString("name").slice(0, 100),
          mentionable: false,
          hoist: false,
          permissions: [],
          reason: `Booster role for ${interaction.user.tag}`,
        });
        await positionRole(guild, role, settings.anchorRoleId);
        const { warnings } = await applyRoleStyle(guild, role, style, settings);
        await interaction.member.roles.add(role, "Booster role assignment").catch(() => {});
        boostStore.set(guild.id, interaction.user.id, role.id);

        const base = `Created your booster role ${role}! It's been assigned to you.`;
        return interaction.editReply({ embeds: [warnings.length ? warn(`${base}\nNotes:\n• ${warnings.join("\n• ")}`) : success(base)] });
      } catch (err) {
        return interaction.editReply({ embeds: [danger(`Couldn't create the role: ${err.message}`)] });
      }
    }
  },
};

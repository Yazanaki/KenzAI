// modules/clantracking/clan.js
// ✅ COMPLETE FIX: Includes type option in setrole command
// ✅ NEW: Shows actual resident count from clans.json

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const clanlogic = require("./clanlogic");
const draftConfig = require("../empire/draftconfig");
const { loadRolesConfig } = require("../roles/roledetector");
const { createClanEmbed } = require("./clanembed");
const { addGuildRoles, removeGuildRoles } = require("../roles/roledetector");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { readMembers } = require("../database/membersPersistence");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clan")
    .setDescription("Manage or view clan information")
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Add a clan")
        .addStringOption(opt => opt.setName("guildid").setDescription("Discord Guild ID of the clan").setRequired(true))
        .addStringOption(opt => opt.setName("abbreviation").setDescription("Clan abbreviation (e.g., SNU, ONA)").setRequired(true))
        .addStringOption(opt => opt.setName("name").setDescription("Full clan name").setRequired(true))
        .addRoleOption(opt => opt.setName("yazanakirole").setDescription("Role in YAZANAKI discord for this clan").setRequired(false))
        .addRoleOption(opt => opt.setName("clanrole").setDescription("Role in THIS CLAN's discord for members").setRequired(false))
        .addStringOption(opt =>
          opt
            .setName("applicationmode")
            .setDescription("Application mode for this clan")
            .addChoices(
              { name: "Manual (staff accept manually)", value: "manual" },
              { name: "Automatic (auto-accept after onboarding)", value: "automatic" }
            )
            .setRequired(false)
        )
        .addAttachmentOption(opt => opt.setName("flag").setDescription("Optional clan flag PNG"))
    )
    .addSubcommand(sub =>
      sub
        .setName("edit")
        .setDescription("Edit an existing clan (roles, name, flag, etc.)")
        .addStringOption(opt => opt.setName("clan").setDescription("Existing clan name or abbreviation").setRequired(true))
        .addStringOption(opt => opt.setName("abbreviation").setDescription("New clan abbreviation (e.g., SNU, ONA)").setRequired(false))
        .addStringOption(opt => opt.setName("name").setDescription("New full clan name").setRequired(false))
        .addRoleOption(opt => opt.setName("yazanakirole").setDescription("New role in YAZANAKI discord for this clan").setRequired(false))
        .addRoleOption(opt => opt.setName("clanrole").setDescription("New role in THIS CLAN's discord for members").setRequired(false))
        .addStringOption(opt =>
          opt
            .setName("applicationmode")
            .setDescription("New application mode for this clan")
            .addChoices(
              { name: "Manual (staff accept manually)", value: "manual" },
              { name: "Automatic (auto-accept after onboarding)", value: "automatic" }
            )
            .setRequired(false)
        )
        .addAttachmentOption(opt => opt.setName("flag").setDescription("New clan flag PNG (replaces existing)"))
        .addStringOption(opt =>
          opt
            .setName("server")
            .setDescription("Server this clan is on (e.g., donutsmp, or 'clear' to remove)")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Remove a clan")
        .addStringOption(opt => opt.setName("clan").setDescription("Clan name, abbreviation, or guild ID").setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription("View clan info")
        .addStringOption(opt => opt.setName("clan").setDescription("Clan name or abbreviation"))
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription("List all registered clans")
    )
    .addSubcommand(sub =>
      sub
        .setName("sync-residents")
        .setDescription("Sync resident counts from members.json (ONE-TIME USE)")
    ),

  async execute(interaction) {
    const isAdminCommand = ['add', 'edit', 'remove', 'sync-residents'].includes(interaction.options.getSubcommand());
    
    if (isAdminCommand) {
      try {
        const yazanakiGuild = await interaction.client.guilds.fetch(draftConfig.YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
        const yazanakiMember = yazanakiGuild
          ? await yazanakiGuild.members.fetch(interaction.user.id).catch(() => null)
          : null;

        // Load Royalty role ID from roles.json (statusRoles in Yazanaki Empire)
        const rolesConfig = loadRolesConfig();
        const yazanakiConfig = rolesConfig?.guilds?.[draftConfig.YAZANAKI_EMPIRE_GUILD_ID];
        let royaltyRoleId = null;

        if (yazanakiConfig && yazanakiConfig.statusRoles) {
          const royaltyEntry = Object.entries(yazanakiConfig.statusRoles).find(
            ([, roleData]) => roleData?.name === "Royalty"
          );
          if (royaltyEntry) {
            royaltyRoleId = royaltyEntry[0];
          }
        }

        // Fallback to known Royalty role ID if not found in config
        if (!royaltyRoleId) {
          royaltyRoleId = "1334642034472128654";
        }

        if (!yazanakiGuild || !yazanakiMember || !royaltyRoleId || !yazanakiMember.roles.cache.has(royaltyRoleId)) {
          return interaction.reply({
            content: "❌ You must have the **Royalty** role in the Yazanaki Empire discord to create, edit, or remove clans.",
            ephemeral: true
          });
        }
      } catch (err) {
        console.error("[clan] Error checking Royalty role in Yazanaki Empire:", err);
        return interaction.reply({
          content: "❌ Failed to verify your permissions in the Yazanaki Empire discord. Please try again later.",
          ephemeral: true
        });
      }
    }

    const sub = interaction.options.getSubcommand();
    const clans = clanlogic.readClans();

    // -------------------------------------------------------------------------
    // ADD CLAN
    // -------------------------------------------------------------------------
    if (sub === "add") {
      await interaction.deferReply();

      const guildId = interaction.options.getString("guildid");
      const abbr = interaction.options.getString("abbreviation").toUpperCase();
      const name = interaction.options.getString("name");
      const yazanakiRole = interaction.options.getRole("yazanakirole");
      const clanRole = interaction.options.getRole("clanrole");
      const applicationModeOption = interaction.options.getString("applicationmode");

      const applicationMode = applicationModeOption === "automatic" ? "automatic" : "manual";

      if (clans[guildId]) {
        return interaction.editReply({
          content: "❌ That guild is already registered as a clan.",
          ephemeral: true
        });
      }

      // Auto-create (or reuse) a role in the MAIN Yazanaki discord named after
      // the clan abbreviation, unless an explicit yazanaki role was supplied.
      let resolvedYazanakiRole = yazanakiRole;
      let yazanakiRoleNote = null;
      if (!resolvedYazanakiRole) {
        try {
          const mainGuild = await interaction.client.guilds
            .fetch(draftConfig.YAZANAKI_EMPIRE_GUILD_ID)
            .catch(() => null);

          if (!mainGuild) {
            yazanakiRoleNote = "⚠️ Could not access the Yazanaki Empire server to create the clan role.";
          } else {
            const allRoles = await mainGuild.roles.fetch().catch(() => mainGuild.roles.cache);
            const existing = allRoles?.find(r => r.name.toLowerCase() === abbr.toLowerCase());

            if (existing) {
              resolvedYazanakiRole = existing;
              yazanakiRoleNote = `♻️ Reused existing Yazanaki role **${existing.name}**`;
            } else {
              resolvedYazanakiRole = await mainGuild.roles.create({
                name: abbr,
                mentionable: true,
                reason: `Auto-created for clan ${abbr} (${name}) via /clan add by ${interaction.user.tag}`,
              });
              yazanakiRoleNote = `🎭 Created Yazanaki role **${abbr}** in the main server`;
            }
          }
        } catch (err) {
          console.error("[clan add] Failed to auto-create Yazanaki role:", err);
          yazanakiRoleNote =
            `⚠️ Failed to auto-create the Yazanaki role (${err.message}). ` +
            `Set it manually with \`/clan edit clan:${abbr} yazanakirole:@Role\`.`;
        }
      }

      clans[guildId] = {
        abbr,
        name,
        joinedEmpire: new Date().toISOString().split("T")[0],
        yazanakiRoleId: resolvedYazanakiRole ? resolvedYazanakiRole.id : null,
        clanRoleId: clanRole ? clanRole.id : null,
        residents: 0, // ✅ Initialize with 0 residents
        applicationMode // ✅ Per-clan application mode
      };

      try {
        const channel = interaction.channel;
        const invite = await channel?.createInvite({ maxAge: 0, maxUses: 0, unique: true });
        clans[guildId].invite = invite?.url || "#";
      } catch (err) {
        console.warn("Failed to create invite:", err);
        clans[guildId].invite = "#";
      }

      clanlogic.writeClans(clans);

      try {
        const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
        
        if (guild) {
          const roleSuccess = await addGuildRoles(guildId, name, guild);
          
          let response = `✅ **Clan Added: ${abbr} - ${name}**\n\n`;
          
          if (roleSuccess) {
            response += `🎭 Guild roles imported\n\n`;
          }
          
          response += `**Role Status:**\n`;

          if (resolvedYazanakiRole) {
            response += `✅ Yazanaki Role: ${resolvedYazanakiRole}\n`;
          } else {
            response += `❌ Yazanaki Role: NOT SET\n`;
            response += `   Set it with \`/clan edit clan:${abbr} yazanakirole:@Role\`\n`;
          }
          if (yazanakiRoleNote) response += `   ${yazanakiRoleNote}\n`;
          
          if (clanRole) {
            response += `✅ Clan Role: ${clanRole}\n`;
          } else {
            response += `⚠️ Clan Role: NOT SET (Optional)\n`;
            response += `   Set it with \`/clan edit clan:${abbr} clanrole:@Role\`\n`;
          }

          const modeLabel = applicationMode === "automatic" ? "Automatic" : "Manual";
          response += `\n📝 Application Mode: **${modeLabel}**\n`;

          response += `\n📊 Residents: 0 (use /clan sync-residents to populate from existing members)`;
          
          return interaction.editReply({ content: response });
        } else {
          return interaction.editReply({
            content:
              `✅ Clan **${abbr}** added.` +
              (resolvedYazanakiRole ? `\n✅ Yazanaki Role: ${resolvedYazanakiRole}` : "") +
              (yazanakiRoleNote ? `\n${yazanakiRoleNote}` : "") +
              `\n⚠️ Bot not in the clan's guild — set the clan-side role with \`/clan edit\`.`
          });
        }
      } catch (err) {
        console.error("[clan add] Error:", err);
        return interaction.editReply({
          content: `⚠️ Clan added but setup incomplete: ${err.message}`
        });
      }
    }

    // -------------------------------------------------------------------------
    // EDIT CLAN (ROLES, NAME, FLAG, ETC.)
    // -------------------------------------------------------------------------
    if (sub === "edit") {
      await interaction.deferReply();

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[/clan edit] 🎯 Command invoked by: ${interaction.user.tag} (${interaction.user.id})`);

      const clanInput = interaction.options.getString("clan");
      const newAbbr = interaction.options.getString("abbreviation");
      const newName = interaction.options.getString("name");
      const newYazanakiRole = interaction.options.getRole("yazanakirole");
      const newClanRole = interaction.options.getRole("clanrole");
      const newFlag = interaction.options.getAttachment("flag");
      const newApplicationMode = interaction.options.getString("applicationmode");
      const newServer = interaction.options.getString("server");

      console.log(`[/clan edit] 📋 Target clan: ${clanInput}`);
      if (newAbbr) console.log(`[/clan edit] ✏️ Option: abbreviation → ${newAbbr}`);
      if (newName) console.log(`[/clan edit] ✏️ Option: name → ${newName}`);
      if (newYazanakiRole) console.log(`[/clan edit] 🎭 Option: yazanakirole`);
      if (newClanRole) console.log(`[/clan edit] 🎭 Option: clanrole`);
      if (newFlag) console.log(`[/clan edit] 🚩 Option: flag (attachment)`);
      if (newApplicationMode) console.log(`[/clan edit] 📝 Option: applicationmode → ${newApplicationMode}`);
      if (newServer !== undefined && newServer !== null) console.log(`[/clan edit] 🟠 Option: server → ${newServer}`);

      const guildId = Object.keys(clans).find(id =>
        clans[id].abbr.toLowerCase() === clanInput.toLowerCase() ||
        clans[id].name.toLowerCase() === clanInput.toLowerCase()
      );

      if (!guildId || !clans[guildId]) {
        console.log(`[/clan edit] ❌ Clan not found: ${clanInput}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return interaction.editReply({
          content: `❌ Clan **${clanInput}** not found.`,
          ephemeral: true
        });
      }

      const clan = clans[guildId];
      console.log(`[/clan edit] ✅ Resolved to guild ${guildId} (${clan.abbr}: ${clan.name})`);
      const changes = [];

      // Name / abbreviation updates
      const oldAbbr = clan.abbr;
      if (newAbbr && newAbbr.toUpperCase() !== clan.abbr.toUpperCase()) {
        clan.abbr = newAbbr.toUpperCase();
        changes.push(`✏️ Abbreviation: \`${oldAbbr}\` → \`${clan.abbr}\``);

        // If a flag exists for the old abbreviation, move it to the new one
        try {
          const oldFlagPath = clanlogic.getFlagPath(oldAbbr);
          if (fs.existsSync(oldFlagPath)) {
            const newFlagPath = clanlogic.getFlagPath(clan.abbr);
            fs.renameSync(oldFlagPath, newFlagPath);
          }
        } catch (err) {
          console.warn("[clan edit] Failed to move existing flag file:", err);
        }
      }

      if (newName && newName !== clan.name) {
        const oldName = clan.name;
        clan.name = newName;
        changes.push(`✏️ Name: \`${oldName}\` → \`${clan.name}\``);
      }

      // Role updates
      if (newYazanakiRole) {
        clan.yazanakiRoleId = newYazanakiRole.id;
        changes.push(`🎭 Yazanaki Role set to: ${newYazanakiRole}`);
      }

      if (newClanRole) {
        clan.clanRoleId = newClanRole.id;
        changes.push(`🎭 Clan Role set to: ${newClanRole}`);
      }

      // Application mode update
      if (newApplicationMode) {
        const oldMode = clan.applicationMode || "manual";
        if (newApplicationMode !== oldMode) {
          clan.applicationMode = newApplicationMode;
          // Legacy "timed" (never implemented) is treated as Manual.
          const modeLabel = (m) => (m === "automatic" ? "Automatic" : "Manual");
          changes.push(`📝 Application Mode: \`${modeLabel(oldMode)}\` → \`${modeLabel(newApplicationMode)}\``);
        }
      }

      // Flag update
      if (newFlag) {
        try {
          await clanlogic.saveFlagFromAttachment(clan.abbr, newFlag);
          changes.push("🚩 Clan flag updated.");
        } catch (err) {
          console.error("[clan edit] Failed to save new flag:", err);
          changes.push("⚠️ Failed to update clan flag (only PNG is allowed).");
        }
      }

      // Servers option (currently only DonutSMP supported)
      if (newServer !== undefined && newServer !== null) {
        const v = newServer.trim().toLowerCase();
        if (v === "" || v === "clear") {
          delete clan.donutsmpTeamName;
          changes.push("🟠 Servers: cleared DonutSMP link.");
          console.log(`[/clan edit] 🟠 Servers: cleared DonutSMP link for ${clan.abbr}`);
        } else if (v === "donutsmp") {
          // For DonutSMP we treat the clan abbreviation as the in-game team name by default
          clan.donutsmpTeamName = clan.abbr;
          changes.push(`🟠 Servers: linked to DonutSMP (team \`${clan.donutsmpTeamName}\`).`);
          console.log(`[/clan edit] 🟠 Servers: linked ${clan.abbr} to DonutSMP (team: ${clan.donutsmpTeamName})`);
        } else {
          changes.push(`⚠️ Servers: unknown server \`${v}\` (supported: \`donutsmp\`). No server link changed.`);
          console.log(`[/clan edit] ⚠️ Servers: unknown server "${v}", no link changed`);
        }
      }

      if (!changes.length) {
        console.log(`[/clan edit] ℹ️ No changes provided`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return interaction.editReply({
          content: "ℹ️ No changes were provided. Specify at least one field to edit.",
          ephemeral: true
        });
      }

      clanlogic.writeClans(clans);

      console.log(`[/clan edit] ✅ Clan updated: ${clan.abbr} - ${clan.name}`);
      console.log(`[/clan edit] 📝 Changes: ${changes.length} item(s)`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return interaction.editReply({
        content:
          `✅ **Clan Updated: ${clan.abbr} - ${clan.name}**\n\n` +
          changes.join("\n")
      });
    }

    // -------------------------------------------------------------------------
    // REMOVE CLAN
    // -------------------------------------------------------------------------
    if (sub === "remove") {
      await interaction.deferReply();
      const input = interaction.options.getString("clan");

      // Resolve by exact guild ID, or by abbreviation / full name (case-insensitive).
      const guildId = clans[input]
        ? input
        : Object.keys(clans).find(id =>
            clans[id].abbr?.toLowerCase() === input.toLowerCase() ||
            clans[id].name?.toLowerCase() === input.toLowerCase()
          );

      if (!guildId || !clans[guildId]) {
        return interaction.editReply({ content: `❌ Clan **${input}** not found.`, ephemeral: true });
      }

      const removed = clans[guildId];
      delete clans[guildId];
      clanlogic.writeClans(clans);

      try {
        clanlogic.deleteFlag(removed.abbr);
      } catch {}

      try {
        removeGuildRoles(guildId);
        return interaction.editReply({
          content: `🗑️ Removed clan **${removed.abbr}: ${removed.name}**`
        });
      } catch (err) {
        return interaction.editReply({
          content: `🗑️ Removed clan **${removed.abbr}: ${removed.name}**`
        });
      }
    }

    // -------------------------------------------------------------------------
    // VIEW CLAN
    // -------------------------------------------------------------------------
    if (sub === "view") {
      await interaction.deferReply();

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[/clan view] 🎯 Command invoked by: ${interaction.user.tag} (${interaction.user.id})`);

      let input = interaction.options.getString("clan");
      let guildId;

      if (!input) {
        guildId = interaction.guildId;
      } else {
        guildId = Object.keys(clans).find(id =>
          clans[id].abbr.toLowerCase() === input.toLowerCase() ||
          clans[id].name.toLowerCase() === input.toLowerCase()
        );
      }

      if (!guildId || !clans[guildId]) {
        console.log(`[/clan view] ❌ Clan not found: ${input || "(current guild)"}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return interaction.editReply({ content: "❌ Clan not found.", ephemeral: true });
      }

      const clan = clans[guildId];
      console.log(`[/clan view] ✅ Viewing clan: ${clan.abbr} - ${clan.name} (guild ${guildId})`);
      const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);

      if (!guild) {
        return interaction.editReply({
          content: "⚠️ Bot cannot access that guild.",
          ephemeral: true
        });
      }

      const owner = await guild.fetchOwner().catch(() => null);
      const leader = owner ? `<@${owner.id}>` : "`n/d`";
      
      // ✅ NEW: Get actual resident count from clans.json
      const residentCount = clan.residents || 0;
      const residents = `\`${residentCount}\``;

      const jd = clan.joinedEmpire?.split("-");
      const joinedDateText = jd?.length === 3 ? `\`${jd[2]}/${jd[1]}/${jd[0]}\`` : "`n/d`";

      const size = `\`${guild.memberCount}\``;
      const appMode = clan.applicationMode || "manual";
      const appModeLabel = appMode === "automatic" ? "Automatic" : "Manual";

      let invite = clan.invite || "#";
      try {
        const channel = interaction.channel;
        const currentInvites = await guild.invites.fetch().catch(() => null);
        let existing = currentInvites?.find(i => i.url === invite);
        if (!existing) {
          const newInvite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true });
          invite = newInvite?.url || "#";
          clan.invite = invite;
          clanlogic.writeClans(clans);
        }
      } catch (err) {
        console.warn("Failed to fetch/create invite:", err);
      }

      const inviteTxt = `[Join ${clan.abbr}](${invite})`;
      const iconURL = guild.iconURL({ size: 256, extension: "png" });

      const bannerPath = clanlogic.getFlagPath(clan.abbr);
      let useBannerPath = false;

      const bannerURL = guild.bannerURL({ size: 512, extension: "png" });
      if (bannerURL) {
        await new Promise((resolve) => {
          const file = fs.createWriteStream(bannerPath);
          https.get(bannerURL, (res) => {
            if (res.statusCode === 200) {
              res.pipe(file);
              file.on("finish", () => { file.close(); useBannerPath = true; resolve(); });
            } else resolve();
          }).on("error", () => resolve());
        });
      }

      const flagExists = clanlogic.flagExists(clan.abbr);
      const flagFileName = `${clan.abbr.toUpperCase()}.png`;
      const flagPath = clanlogic.getFlagPath(clan.abbr);

      let embedColor = 0x000000;
      try {
        if (useBannerPath) embedColor = await clanlogic.getDominantColor(bannerPath);
        else if (flagExists) embedColor = await clanlogic.getDominantColor(flagPath);
        else if (iconURL) embedColor = await clanlogic.getDominantColor(iconURL);
      } catch {}

      const embed = createClanEmbed(
        clan,
        leader,
        residents,
        joinedDateText,
        size,
        inviteTxt,
        iconURL,
        useBannerPath || flagExists ? flagFileName : null,
        embedColor,
        appModeLabel
      );

      const components = [];
      let serverRow = null;
      if (clan.donutsmpTeamName) {
        console.log(`[/clan view] 🟠 Adding DonutSMP button for clan ${clan.abbr} (guild ${guildId})`);
        serverRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`clan_server_donutsmp_${guildId}`)
            .setLabel("DonutSMP")
            .setStyle(ButtonStyle.Secondary)
        );
        components.push(serverRow);
      }

      if (useBannerPath || flagExists) {
        const attachment = new AttachmentBuilder(useBannerPath ? bannerPath : flagPath, { name: flagFileName });
        console.log(`[/clan view] ✅ Sending clan embed for ${clan.abbr} (with flag, components: ${components.length})`);
        const message = await interaction.editReply({ embeds: [embed], files: [attachment], components });
        if (serverRow) {
          setTimeout(async () => {
            try {
              const disabledRow = new ActionRowBuilder().addComponents(
                ButtonBuilder.from(serverRow.components[0]).setDisabled(true)
              );
              await message.edit({ components: [disabledRow] });
            } catch {
              // ignore edit errors
            }
          }, 10 * 60 * 1000);
        }
        return message;
      }

      console.log(`[/clan view] ✅ Sending clan embed for ${clan.abbr} (components: ${components.length})`);
      const message = await interaction.editReply({ embeds: [embed], components });
      if (serverRow) {
        setTimeout(async () => {
          try {
            const disabledRow = new ActionRowBuilder().addComponents(
              ButtonBuilder.from(serverRow.components[0]).setDisabled(true)
            );
            await message.edit({ components: [disabledRow] });
          } catch {
            // ignore edit errors
          }
        }, 10 * 60 * 1000);
      }
      return message;
    }

    // -------------------------------------------------------------------------
    // LIST CLANS
    // -------------------------------------------------------------------------
    if (sub === "list") {
      await interaction.deferReply();
      const arr = Object.entries(clans);
      if (!arr.length) return interaction.editReply({ content: "No clans registered.", ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle("__Registered Clans__")
        .setColor(0x000000)
        .setDescription(arr.map(([id, c]) => {
          const invite = c.invite || "n/d";
          const yazanakiStatus = c.yazanakiRoleId ? "✅" : "❌";
          const clanStatus = c.clanRoleId ? "✅" : "⚠️";
          const residentCount = c.residents || 0;
          const mode = c.applicationMode === "automatic" ? "Automatic" : "Manual";
          return `${yazanakiStatus}${clanStatus} [${c.abbr}: ${c.name}](${invite}) - ${residentCount} residents - Mode: ${mode}`;
        }).join("\n"))
        .setFooter({ text: "✅ = Set | ❌ = Missing Yazanaki role | ⚠️ = Missing clan role" });

      return interaction.editReply({ embeds: [embed] });
    }

    // -------------------------------------------------------------------------
    // ✅ NEW: SYNC RESIDENTS (ONE-TIME USE)
    // -------------------------------------------------------------------------
    if (sub === "sync-residents") {
      await interaction.deferReply({ ephemeral: true });

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("[clan sync-residents] 🔄 Starting resident count sync...");

      const members = readMembers();
      if (!members || typeof members !== "object" || Object.keys(members).length === 0) {
        console.log("[clan sync-residents] ❌ No members loaded");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return interaction.editReply({
          content: "❌ No members data available to sync.",
          ephemeral: true
        });
      }

      // Count members per clan
      const clanCounts = {};

      for (const [discordId, member] of Object.entries(members)) {
        const clanName = member.JoinedClan;
        
        if (!clanName) {
          console.log(`[clan sync-residents] ⚠️ Member ${discordId} has no clan`);
          continue;
        }

        // Find the guild ID for this clan name
        const guildId = Object.keys(clans).find(id => 
          clans[id].name === clanName || clans[id].abbr === clanName
        );

        if (!guildId) {
          console.log(`[clan sync-residents] ⚠️ Clan "${clanName}" not found in clans.json`);
          continue;
        }

        clanCounts[guildId] = (clanCounts[guildId] || 0) + 1;
      }

      console.log(`[clan sync-residents] 📊 Found ${Object.keys(clanCounts).length} clans with members`);

      // Update each clan's resident count
      let updatedCount = 0;
      const updates = [];

      for (const [guildId, count] of Object.entries(clanCounts)) {
        const clan = clans[guildId];
        
        if (!clan) continue;

        const oldCount = clan.residents || 0;
        clan.residents = count;
        
        console.log(`[clan sync-residents] 🔄 ${clan.abbr}: ${oldCount} → ${count}`);
        
        updates.push(`**${clan.abbr}**: ${oldCount} → ${count} residents`);
        updatedCount++;
      }

      // Zero out clans with no members
      for (const [guildId, clan] of Object.entries(clans)) {
        if (!clanCounts[guildId]) {
          const oldCount = clan.residents || 0;
          clan.residents = 0;
          
          if (oldCount > 0) {
            console.log(`[clan sync-residents] 🔄 ${clan.abbr}: ${oldCount} → 0`);
            updates.push(`**${clan.abbr}**: ${oldCount} → 0 residents`);
            updatedCount++;
          }
        }
      }

      clanlogic.writeClans(clans);

      console.log(`[clan sync-residents] ✅ Updated ${updatedCount} clans`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      const embed = new EmbedBuilder()
        .setTitle("✅ Resident Count Sync Complete")
        .setDescription(
          `Successfully synced resident counts from members.json\n\n` +
          `**Updated ${updatedCount} clan(s):**\n\n` +
          updates.join("\n")
        )
        .setColor(0x00AA00)
        .setFooter({ text: "Future acceptances will auto-update counts" });

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
  }
};
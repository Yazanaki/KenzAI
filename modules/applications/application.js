const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  MessageFlags
} = require("discord.js");

const transcript = require("../tickets/transcript");
const cache = require("../data/cache");
const { saveApplicant, getApplicant } = require("./applicants");
const autolink = require("../linking/autolink");
const { acceptApplicant } = require("./acceptedapplicants.js");
const { checkApplicationEligibility } = require("../membertracking/memberkickban");
const { loadRolesConfig } = require("../roles/roledetector");
const draftConfig = require("../empire/draftconfig");
const onboardingFlow = require("../onboarding/onboardingflow");

// Yazanaki Empire Guild ID (used for Royalty role check)
const YAZANAKI_EMPIRE_GUILD_ID = draftConfig.YAZANAKI_EMPIRE_GUILD_ID;

/**
 * ✅ Check if the interaction user has the Royalty role in Yazanaki Empire
 * Only Royalty members should be able to post the application embed
 */
async function hasRoyaltyRole(interaction) {
  try {
    const yazanakiGuild = await interaction.client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
    if (!yazanakiGuild) {
      console.warn("[application] ⚠️ Could not fetch Yazanaki Empire guild for Royalty check");
      return false;
    }

    const yazanakiMember = await yazanakiGuild.members.fetch(interaction.user.id).catch(() => null);
    if (!yazanakiMember) {
      console.warn(`[application] ⚠️ User ${interaction.user.tag} not in Yazanaki Empire — no Royalty role`);
      return false;
    }

    // Load Royalty role ID from roles.json
    const rolesConfig = loadRolesConfig();
    const yazanakiConfig = rolesConfig?.guilds?.[YAZANAKI_EMPIRE_GUILD_ID];
    let royaltyRoleId = null;

    if (yazanakiConfig && yazanakiConfig.statusRoles) {
      const royaltyEntry = Object.entries(yazanakiConfig.statusRoles).find(
        ([, roleData]) => roleData?.name === "Royalty"
      );
      if (royaltyEntry) {
        royaltyRoleId = royaltyEntry[0];
      }
    }

    // Fallback to known Royalty role ID
    if (!royaltyRoleId) {
      royaltyRoleId = "1334642034472128654";
    }

    const hasRole = yazanakiMember.roles.cache.has(royaltyRoleId);
    console.log(`[application] 👑 Royalty check for ${interaction.user.tag}: ${hasRole ? "✅ HAS Royalty" : "❌ NO Royalty"}`);
    return hasRole;

  } catch (err) {
    console.error("[application] ❌ Error checking Royalty role:", err);
    return false;
  }
}

/**
 * Build permission overwrites for a new ticket channel.
 * Inherits all overwrites from the parent category, then adds/merges
 * the applicant's personal overwrite and the bot's overwrite on top.
 * This ensures every role that can see the category can also see the ticket.
 */
function buildTicketOverwrites(category, applicantId, botId) {
  // Copy all existing category overwrites (roles + specific users already set there)
  const overwrites = category.permissionOverwrites.cache.map(overwrite => ({
    id: overwrite.id,
    allow: overwrite.allow,
    deny: overwrite.deny,
    type: overwrite.type
  }));

  // Add (or override) the applicant's personal overwrite
  const existingApplicantIdx = overwrites.findIndex(o => o.id === applicantId);
  const applicantOverwrite = {
    id: applicantId,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.AttachFiles,
      PermissionsBitField.Flags.EmbedLinks
    ]
  };
  if (existingApplicantIdx !== -1) {
    overwrites[existingApplicantIdx] = applicantOverwrite;
  } else {
    overwrites.push(applicantOverwrite);
  }

  // Add (or override) the bot's overwrite
  const existingBotIdx = overwrites.findIndex(o => o.id === botId);
  const botOverwrite = {
    id: botId,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageMessages
    ]
  };
  if (existingBotIdx !== -1) {
    overwrites[existingBotIdx] = botOverwrite;
  } else {
    overwrites.push(botOverwrite);
  }

  return overwrites;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("application")
    .setDescription("Post the application starter embed for the Yazanaki Empire."),

  async execute(interaction) {
    // ✅ FIXED: Only Yazanaki Royalty can post the application embed
    const royalty = await hasRoyaltyRole(interaction);
    if (!royalty) {
      return interaction.reply({
        content: "❌ You need the **Royalty** role in the Yazanaki Empire discord to use this command.",
        ephemeral: true
      });
    }

    const guild = interaction.guild;

    const appEmbed = new EmbedBuilder()
      .setTitle("Start your Application!")
      .setDescription(
        `Join **${guild.name}** of the Yazanaki Empire by clicking the button below to open an application ticket!`
      )
      .setColor("#000000");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("start_application")
        .setLabel("Apply")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({
      embeds: [appEmbed],
      components: [row]
    });
  },

  async buttonHandler(interaction) {
    const guild = interaction.guild;

    // 🟢 Open Application Ticket (Modal)
    if (interaction.customId === "start_application") {
      // ============================================================
      // ✅ CHECK KICK/BAN STATUS BEFORE ALLOWING APPLICATION
      // ============================================================
      const eligibility = checkApplicationEligibility(interaction.user.id);
      
      if (!eligibility.eligible) {
        console.log(`[application] ⛔ Application blocked for ${interaction.user.tag}`);
        console.log(`[application] 📋 Status: ${eligibility.status}`);
        console.log(`[application] 📋 Reason: ${eligibility.reason}`);
        
        return interaction.reply({
          content: eligibility.message,
          ephemeral: true
        });
      }
      
      console.log(`[application] ✅ ${interaction.user.tag} is eligible to apply`);
      
      // ============================================================
      // CONTINUE WITH NORMAL APPLICATION FLOW
      // ============================================================
      
      const category = guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildCategory &&
          c.name.toLowerCase().includes("applications")
      );

      if (!category) {
        return interaction.reply({
          content:
            "❌ No category for applications found. Create one with 'applications' in its name.",
          flags: MessageFlags.Ephemeral
        });
      }

      const existing = guild.channels.cache.find(
        (ch) =>
          ch.parentId === category.id &&
          ch.name.startsWith(
            interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "")
          )
      );

      if (existing) {
        return interaction.reply({
          content: `❌ You already have an open application: ${existing}`,
          flags: MessageFlags.Ephemeral
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`application_modal_${interaction.user.id}`)
        .setTitle("Empire Application")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("minecraft_name")
              .setLabel("Minecraft Username (no spaces)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("minecraft_version")
              .setLabel("Minecraft Version (Java or Bedrock only)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("timezone")
              .setLabel("Your Timezone (e.g., GMT+1)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("previous_groups")
              .setLabel("Previous Groups")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Why do you want to join?")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          )
        );

      return interaction.showModal(modal);
    }

    // 🔒 Close Ticket modal
    if (interaction.customId === "close_ticket") {
      const modal = new ModalBuilder()
        .setCustomId(`close_reason_modal_${interaction.channel.id}`)
        .setTitle("Close Ticket")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("close_reason")
              .setLabel("Reason for closing this ticket")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }

    // ============================================================
    // ✅ ACCEPT / REJECT WITH DUPLICATE PREVENTION
    // ============================================================
    if (
      interaction.customId.startsWith("accept_application_") ||
      interaction.customId.startsWith("reject_application_")
    ) {
      const member = interaction.member;

      if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.reply({
          content: "❌ You lack the required permission.",
          ephemeral: true
        });
      }

      const isAccepted = interaction.customId.startsWith("accept_application_");
      const discordId = interaction.customId.split("_").pop();

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[application] 🎯 ${isAccepted ? 'Accept' : 'Reject'} button clicked`);
      console.log(`[application] 👤 Target: ${discordId}`);
      console.log(`[application] 👮 Moderator: ${interaction.user.tag}`);

      const applicantData = getApplicant(discordId);
      if (!applicantData) {
        console.log(`[application] ❌ Applicant not found`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return interaction.reply({
          content: "⚠️ Applicant not found.",
          ephemeral: true
        });
      }

      // ============================================================
      // ✅ CHECK IF ALREADY PROCESSED
      // ============================================================
      if (applicantData.closedAt) {
        console.log(`[application] ⚠️ Application already processed`);
        console.log(`[application] 📅 Original close date: ${applicantData.closedAt}`);
        console.log(`[application] 📊 Status: ${applicantData.accepted ? 'Accepted' : 'Rejected'}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

        try {
          const currentMessage = interaction.message;
          
          const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("close_ticket")
              .setLabel("🔒 Close Ticket")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`accept_application_${discordId}`)
              .setLabel("✅ Accept")
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`reject_application_${discordId}`)
              .setLabel("❌ Reject")
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true)
          );

          await currentMessage.edit({ components: [newRow] });
          console.log(`[application] 🔒 Accept/Reject buttons disabled`);
        } catch (err) {
          console.warn(`[application] ⚠️ Could not disable buttons:`, err.message);
        }

        const statusText = applicantData.accepted ? "✅ Accepted" : "❌ Rejected";
        const closeDate = new Date(applicantData.closedAt).toLocaleString('en-GB');

        return interaction.reply({
          content: 
            `⚠️ **This application has already been processed!**\n\n` +
            `**Status:** ${statusText}\n` +
            `**Processed on:** ${closeDate}\n\n` +
            `The Accept/Reject buttons have been disabled.`,
          ephemeral: true
        });
      }

      // ============================================================
      // ✅ PROCESS THE APPLICATION (FIRST TIME ONLY)
      // ============================================================
      
      const savedMCUser = applicantData.minecraftUser || applicantData.minecraftName || "";
      const savedMCVersion = applicantData.minecraftVersion || applicantData.minecraftVersion || "";

      saveApplicant(
        discordId,
        {
          discordId,
          discordUser: applicantData.discordUser || applicantData.discordTag || null,
          minecraftUser: savedMCUser,
          ticketChannel: applicantData.ticketChannel,
          ticketNumber: applicantData.ticketNumber,
          timezone: applicantData.timezone,
          previousGroups: applicantData.previousGroups,
          reason: applicantData.reason,
          server: applicantData.server,
          minecraftVersion: savedMCVersion
        },
        applicantData.server ?? interaction.guild.id,
        applicantData.closeReason ?? null,
        isAccepted,
        new Date().toISOString()
      );

      console.log(`[application] 📝 Application marked as ${isAccepted ? 'accepted' : 'rejected'}`);
      console.log(`[application] 📅 Close date: ${new Date().toISOString()}`);

      // ============================================================
      // ✅ DISABLE ONLY ACCEPT/REJECT BUTTONS (KEEP CLOSE BUTTON)
      // ============================================================
      try {
        const currentMessage = interaction.message;
        
        const newRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("close_ticket")
            .setLabel("🔒 Close Ticket")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`accept_application_${discordId}`)
            .setLabel("✅ Accept")
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId(`reject_application_${discordId}`)
            .setLabel("❌ Reject")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true)
        );

        await currentMessage.edit({ components: [newRow] });
        console.log(`[application] 🔒 Accept/Reject buttons disabled successfully`);
      } catch (err) {
        console.warn(`[application] ⚠️ Could not disable buttons:`, err.message);
      }

      // ============================================================
      // ✅ ACCEPT APPLICANT (if accepted)
      // ============================================================
      let acceptResult = null;
      if (isAccepted) {
        console.log(`[application] 🎯 Running acceptance process...`);
        acceptResult = await acceptApplicant(discordId, interaction.client);

        if (acceptResult.success) {
          console.log(`[application] ✅ Acceptance successful`);
          console.log(`[application] 🆔 Empire ID: ${acceptResult.empireId}`);
          console.log(`[application] 🏷️ Clan: ${acceptResult.clan?.abbr}`);
        } else {
          console.error(`[application] ❌ Acceptance failed: ${acceptResult.reason}`);
        }

        // ============================================================
        // ✅ NOT IN YAZANAKI: Revert application, re-enable buttons, notify accepter only
        // ============================================================
        if (!acceptResult.success && acceptResult.reason === "not_in_yazanaki") {
          const currentData = getApplicant(discordId);
          saveApplicant(
            discordId,
            currentData,
            currentData?.server ?? interaction.guild.id,
            currentData?.closeReason ?? null,
            false,
            null
          );
          try {
            const currentMessage = interaction.message;
            const newRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("close_ticket")
                .setLabel("🔒 Close Ticket")
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`accept_application_${discordId}`)
                .setLabel("✅ Accept")
                .setStyle(ButtonStyle.Success)
                .setDisabled(false),
              new ButtonBuilder()
                .setCustomId(`reject_application_${discordId}`)
                .setLabel("❌ Reject")
                .setStyle(ButtonStyle.Danger)
                .setDisabled(false)
            );
            await currentMessage.edit({ components: [newRow] });
          } catch (err) {
            console.warn(`[application] ⚠️ Could not re-enable buttons:`, err.message);
          }

          const notInYazanakiEmbed = new EmbedBuilder()
            .setTitle("❌ Acceptance blocked")
            .setDescription(
              `**<@${discordId}>** has not joined the **Yazanaki Discord** (Yazanaki Empire).\n\n` +
              `They must join the server before they can be accepted. The application has been reverted; you can accept again after they join.`
            )
            .setColor(0xff6600)
            .setTimestamp();

          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          return interaction.reply({
            embeds: [notInYazanakiEmbed],
            ephemeral: true
          });
        }
      }

      // ============================================================
      // ✅ NOTIFY APPLICANT IN CHANNEL
      // ============================================================
      const resultEmbed = new EmbedBuilder()
        .setTitle(isAccepted ? "✅ Application Accepted" : "❌ Application Denied")
        .setDescription(
          isAccepted
            ? "Congratulations! Your application to the Yazanaki Empire has been **accepted**. You have been given the appropriate roles. Welcome!"
            : "Your application to the Yazanaki Empire has been **denied**. If you have questions, please reach out to staff."
        )
        .setColor(isAccepted ? 0x00ff00 : 0xff0000)
        .setTimestamp();

      try {
        await interaction.channel.send({
          content: `<@${discordId}>`,
          embeds: [resultEmbed]
        });
      } catch (err) {
        console.warn(`[application] ⚠️ Could not send applicant result message:`, err.message);
      }

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return interaction.reply({
        content: isAccepted
          ? `✅ <@${discordId}> has been **Accepted**. The Accept/Reject buttons have been disabled.`
          : `❌ <@${discordId}> has been **Rejected**. The Accept/Reject buttons have been disabled.`,
        ephemeral: true
      });
    }
  },

  async modalHandler(interaction) {
    const guild = interaction.guild;

    if (interaction.customId.startsWith("application_modal_")) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const mcName = interaction.fields.getTextInputValue("minecraft_name");
      const mcVersion = interaction.fields.getTextInputValue("minecraft_version");
      const tZone = interaction.fields.getTextInputValue("timezone");
      const prevGroups = interaction.fields.getTextInputValue("previous_groups");
      const reason = interaction.fields.getTextInputValue("reason");

      // ============================================================
      // ✅ TASK 1: VALIDATE MINECRAFT USERNAME AND VERSION
      // ============================================================

      // 1. No spaces allowed in Minecraft username
      if (mcName.includes(" ")) {
        return interaction.editReply({
          content: "❌ Your Minecraft username cannot contain spaces. Please open a new application and enter your username without any spaces.",
          flags: MessageFlags.Ephemeral
        });
      }

      // 2. No spaces allowed in Minecraft version field
      if (mcVersion.trim().includes(" ")) {
        return interaction.editReply({
          content: "❌ The Minecraft version field cannot contain spaces. Please open a new application and enter either **Java** or **Bedrock**.",
          flags: MessageFlags.Ephemeral
        });
      }

      // 3. Minecraft version must be exactly "java" or "bedrock" (case-insensitive)
      const mcVersionNorm = mcVersion.trim().toLowerCase();
      if (mcVersionNorm !== "java" && mcVersionNorm !== "bedrock") {
        return interaction.editReply({
          content: "❌ Invalid Minecraft version. You must enter either **Java** or **Bedrock** — nothing else is accepted. Please open a new application.",
          flags: MessageFlags.Ephemeral
        });
      }

      // ============================================================
      // CONTINUE WITH TICKET CREATION
      // ============================================================

      const category = guild.channels.cache.find((c) =>
        c.name.toLowerCase().includes("applications")
      );

      if (!category) {
        return interaction.editReply({
          content: "❌ Applications category not found.",
          flags: MessageFlags.Ephemeral
        });
      }

      // Ticket numbers are now per clan/guild instead of global
      const ticketNumber = cache.getNextNumber("application", guild.id);
      const channelName = `${interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")}-${ticketNumber}`;

      // ✅ Inherit category permissions so staff roles with category
      // access can see the ticket, while still granting applicant personal access.
      const permissionOverwrites = buildTicketOverwrites(
        category,
        interaction.user.id,
        guild.members.me.id
      );

      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites
      });

      // ✅ Save applicant IMMEDIATELY with minecraftUser field
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[application] 💾 Saving applicant data for ${interaction.user.tag}`);
      console.log(`[application] 🎮 Minecraft: ${mcName}`);
      
      saveApplicant(interaction.user.id, {
        discordId: interaction.user.id,
        discordUser: interaction.user.tag,
        minecraftUser: mcName,
        ticketChannel: channel.id,
        ticketNumber,
        minecraftVersion: mcVersion.trim(),
        timezone: tZone,
        previousGroups: prevGroups,
        reason,
        server: guild.id,
        accepted: false,
        closeReason: null,
        closedAt: null
      });
      
      console.log(`[application] ✅ Applicant data saved`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      // Run autolink AFTER saving, with async/await
      console.log(`[application] 🔗 Starting autolink process...`);
      
      autolink.processApplicant(interaction.user.id, 1000).then(result => {
        if (result.success) {
          console.log(`[application] ✅ Autolink successful: ${result.minecraftUser}`);
        } else {
          console.warn(`[application] ⚠️ Autolink failed: ${result.reason}`);
          console.warn(`[application] ℹ️ User will need to use /link command manually`);
        }
      }).catch(err => {
        console.error(`[application] ❌ Autolink error:`, err);
      });

      cache.set(channel.id, {
        type: "application",
        openerId: interaction.user.id,
        openerTag: interaction.user.tag,
        ticketNumber,
        openedAt: new Date().toISOString()
      });

      const infoEmbed = new EmbedBuilder()
        .setTitle("New Application")
        .addFields(
          { name: "Applicant", value: `<@${interaction.user.id}>` },
          { name: "Minecraft Username", value: mcName },
          { name: "Minecraft Version", value: mcVersion.trim() },
          { name: "Timezone", value: tZone },
          { name: "Previous Groups", value: prevGroups },
          { name: "Reason", value: reason },
          { name: "Opened At", value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        )
        .setColor("#000000");

      const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("🔒 Close Ticket")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`accept_application_${interaction.user.id}`)
          .setLabel("✅ Accept")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_application_${interaction.user.id}`)
          .setLabel("❌ Reject")
          .setStyle(ButtonStyle.Danger)
      );

      // Post the staff-facing info embed + Accept/Reject/Close controls.
      // Keep a handle on this message so onboarding can disable the
      // Accept/Reject buttons if it auto-accepts (automatic clans).
      const controlMessage = await channel.send({
        embeds: [infoEmbed],
        components: [controlRow]
      });

      // Kick off the interactive onboarding flow for the applicant. This
      // replaces the old static "Pre-Application Process" embed: the applicant
      // is walked through the Constitution, key commands, the clan's channels,
      // joining the Empire, and the Empire's channels — then returned here.
      try {
        await onboardingFlow.startOnboarding(
          interaction.client,
          channel,
          { discordId: interaction.user.id, server: guild.id },
          controlMessage.id
        );
      } catch (err) {
        console.error("[application] ❌ Failed to start onboarding:", err);
      }

      await interaction.editReply({
        content: `✅ Your application has been created: ${channel}`,
        flags: MessageFlags.Ephemeral
      });
    }

    // Close reason modal
    if (interaction.customId.startsWith("close_reason_modal_")) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const reason = interaction.fields.getTextInputValue("close_reason");
      const channelId = interaction.customId.split("close_reason_modal_")[1];
      const channel = interaction.guild.channels.cache.get(channelId);

      if (!channel) {
        return interaction.editReply({
          content: "❌ Channel not found.",
          flags: MessageFlags.Ephemeral
        });
      }

      const ticketData = cache.get(channelId);
      if (ticketData) {
        const applicantData = getApplicant(ticketData.openerId);
        if (applicantData) {
          const mcUser = applicantData.minecraftUser || applicantData.minecraftName || "";
          saveApplicant(
            ticketData.openerId,
            {
              ...applicantData,
              discordId: ticketData.openerId,
              discordUser: applicantData.discordUser || applicantData.discordTag || null,
              minecraftUser: mcUser
            },
            interaction.guild.id,
            reason,
            applicantData.accepted ?? false,
            new Date().toISOString()
          );
        }
      }

      await transcript.generate(interaction, channel, reason);

      return interaction.editReply({
        content: "✅ Ticket closed and transcript saved.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
};
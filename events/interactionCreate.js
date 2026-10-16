// Discord Bot/events/interactionCreate.js
// ✅ Single authoritative handler for ALL Discord interactions.
// Loaded by the event loader in index.js — do NOT also add
// client.on('interactionCreate', ...) in index.js or anywhere else.

const { handleDraftChoice } = require("../modules/empire/draftlogic");

// ============================================================
// HELPERS
// ============================================================

async function safeErrorReply(interaction, message = "❌ An error occurred. Please try again or contact staff.") {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  } catch (err) {
    console.error("[interactionCreate] safeErrorReply failed:", err.message);
  }
}

async function commandNotLoadedReply(interaction, commandName) {
  console.error(`[interactionCreate] ❌ Command "${commandName}" not loaded — cannot handle "${interaction.customId}"`);
  await safeErrorReply(interaction, `❌ This button is temporarily unavailable (\`${commandName}\` module failed to load). Please contact staff.`);
}

// ============================================================
// MAIN HANDLER
// ============================================================

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    const client = interaction.client;

    // ----------------------------------------------------------
    // DM BUTTONS — mcbot confirm/reject/freshsmp gamemode
    // These arrive from DMs where interaction.guild is null.
    // ALL mcbot DM buttons must start with "mcbot_" and be listed
    // here so they are forwarded to the mcbot buttonHandler.
    // ----------------------------------------------------------
    if (
      interaction.isButton() &&
      (interaction.customId.startsWith("mcbot_confirm_") ||
        interaction.customId.startsWith("mcbot_reject_") ||
        interaction.customId.startsWith("mcbot_freshsmp_gm_"))
    ) {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[interactionCreate] 📬 DM button: ${interaction.customId} from ${interaction.user.tag}`);
      const mcbotCommand = client.commands.get("mcbot");
      if (mcbotCommand?.buttonHandler) {
        try {
          await mcbotCommand.buttonHandler(interaction);
        } catch (err) {
          console.error("[interactionCreate] ❌ mcbot DM buttonHandler error:", err);
        }
      }
      return;
    }

    // ----------------------------------------------------------
    // AUTOCOMPLETE
    // ----------------------------------------------------------
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          console.error(`[interactionCreate] ❌ Autocomplete error in /${interaction.commandName}:`, err);
        }
      }
      return;
    }

    // ----------------------------------------------------------
    // BUTTONS
    // ----------------------------------------------------------
    if (interaction.isButton()) {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[interactionCreate] 🔘 Button: ${interaction.customId} from ${interaction.user.tag} (${interaction.user.id})`);

      try {

        // Draft choice buttons
        if (interaction.customId.startsWith("draft_")) {
          return await handleDraftChoice(interaction);
        }

        // /empireid list — pagination
        if (interaction.customId.startsWith("empireid_list|nav|")) {
          const cmd = client.commands.get("empireid");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "empireid");
          return await cmd.buttonHandler(interaction);
        }

        // Court request buttons
        if (
          interaction.customId === "start_court_request" ||
          interaction.customId === "close_court_request" ||
          interaction.customId.startsWith("escalate_court_request_") ||
          interaction.customId.startsWith("dismiss_court_request_")
        ) {
          const cmd = client.commands.get("courtrequest");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "courtrequest");
          return await cmd.buttonHandler(interaction);
        }

        // Application system buttons
        if (
          interaction.customId === "start_application" ||
          interaction.customId === "close_ticket" ||
          interaction.customId.startsWith("accept_application_") ||
          interaction.customId.startsWith("reject_application_")
        ) {
          const cmd = client.commands.get("application");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "application");
          return await cmd.buttonHandler(interaction);
        }

        // Onboarding flow buttons (next / joined)
        if (interaction.customId.startsWith("onb|")) {
          const cmd = client.commands.get("onboarding");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "onboarding");
          return await cmd.buttonHandler(interaction);
        }

        // ── /shop category buttons (badges / capes / pets) ───
        if (
          interaction.customId === "shop_badge" ||
          interaction.customId === "shop_cape" ||
          interaction.customId === "shop_pet"
        ) {
          const cmd = client.commands.get("shop");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "shop");
          return await cmd.buttonHandler(interaction);
        }

        // Patreon info button (from mcbot upsell embed)
        if (interaction.customId === "mcbot_patreon_info") {
          const cmd = client.commands.get("mcbot");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "mcbot");
          return await cmd.buttonHandler(interaction);
        }

        // Patreon slot status button (from /patreon embed)
        if (interaction.customId === "patreon_slot_status") {
          const cmd = client.commands.get("patreon");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "patreon");
          return await cmd.buttonHandler(interaction);
        }

        // Server module buttons
        if (
          interaction.customId.startsWith("server_") ||
          interaction.customId.startsWith("clan_server_") ||
          interaction.customId.startsWith("member_server_")
        ) {
          console.log(`[interactionCreate] 🔁 Routing to servers module for ${interaction.customId}`);
          const cmd = client.commands.get("server");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "server");
          return await cmd.buttonHandler(interaction);
        }

        // Stock market buttons (buy/sell/mark-paid)
        if (interaction.customId.startsWith("stock_")) {
          const cmd = client.commands.get("stock");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "stock");
          return await cmd.buttonHandler(interaction);
        }

        // /relink confirm / cancel are handled by an in-command component
        // collector (modules/linking/relink.js), not routed here.
        if (
          interaction.customId === "relink_confirm" ||
          interaction.customId === "relink_cancel"
        ) {
          return;
        }

        // ── Discord module: giveaway entry / management buttons ──
        if (interaction.customId.startsWith("dgw_")) {
          const cmd = client.commands.get("giveaway");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "giveaway");
          return await cmd.buttonHandler(interaction);
        }

        // ── Discord module: leveling leaderboard pagination ──
        if (interaction.customId.startsWith("dlvl_")) {
          const cmd = client.commands.get("leaderboard");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "leaderboard");
          return await cmd.buttonHandler(interaction);
        }

        // ── Discord module: invite leaderboard pagination ──
        if (interaction.customId.startsWith("dinv_")) {
          const cmd = client.commands.get("invites");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "invites");
          return await cmd.buttonHandler(interaction);
        }

        // ── Discord module: /setup dashboard buttons ──
        if (interaction.customId.startsWith("dset_")) {
          const cmd = client.commands.get("setup");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "setup");
          return await cmd.buttonHandler(interaction);
        }

        console.warn(`[interactionCreate] ⚠️ Unhandled button ID: ${interaction.customId}`);

      } catch (err) {
        console.error(`[interactionCreate] ❌ Button handler threw for "${interaction.customId}":`, err);
        await safeErrorReply(interaction);
      }

      return;
    }

    // ----------------------------------------------------------
    // STRING SELECT MENUS
    // ----------------------------------------------------------
    if (interaction.isStringSelectMenu()) {
      try {
        // Stock market — sell-a-position select menu
        if (interaction.customId === "stock_sellpos") {
          const cmd = client.commands.get("stock");
          if (!cmd?.selectMenuHandler) return commandNotLoadedReply(interaction, "stock");
          return await cmd.selectMenuHandler(interaction);
        }

        // /shop buy select
        if (interaction.customId === "shop_buy_select") {
          const cmd = client.commands.get("shop");
          if (!cmd?.selectMenuHandler) return commandNotLoadedReply(interaction, "shop");
          return await cmd.selectMenuHandler(interaction);
        }

        // /profile equip / unequip selects
        if (
          interaction.customId === "profile_equip_select" ||
          interaction.customId === "profile_unequip_select"
        ) {
          const cmd = client.commands.get("profile");
          if (!cmd?.selectMenuHandler) return commandNotLoadedReply(interaction, "profile");
          return await cmd.selectMenuHandler(interaction);
        }

        // /empireid list — filter menu
        if (interaction.customId.startsWith("empireid_list|filter|")) {
          const cmd = client.commands.get("empireid");
          if (!cmd?.selectMenuHandler) return commandNotLoadedReply(interaction, "empireid");
          return await cmd.selectMenuHandler(interaction);
        }

        // ── /setup dashboard string selects ──
        if (interaction.customId.startsWith("dset_")) {
          const cmd = client.commands.get("setup");
          if (!cmd?.selectMenuHandler) return commandNotLoadedReply(interaction, "setup");
          return await cmd.selectMenuHandler(interaction);
        }

        // ── /statistic viewer selects ──
        if (interaction.customId.startsWith("dstat_")) {
          const cmd = client.commands.get("statistic");
          if (!cmd?.selectMenuHandler) return commandNotLoadedReply(interaction, "statistic");
          return await cmd.selectMenuHandler(interaction);
        }

        console.warn(`[interactionCreate] ⚠️ Unhandled select menu ID: ${interaction.customId}`);
      } catch (err) {
        console.error(`[interactionCreate] ❌ Select menu handler threw for "${interaction.customId}":`, err);
        await safeErrorReply(interaction);
      }
      return;
    }

    // ----------------------------------------------------------
    // CHANNEL SELECT MENUS (native pickers — used by /setup)
    // ----------------------------------------------------------
    if (interaction.isChannelSelectMenu()) {
      try {
        if (interaction.customId.startsWith("dset_")) {
          const cmd = client.commands.get("setup");
          if (!cmd?.channelSelectHandler) return commandNotLoadedReply(interaction, "setup");
          return await cmd.channelSelectHandler(interaction);
        }
        console.warn(`[interactionCreate] ⚠️ Unhandled channel select ID: ${interaction.customId}`);
      } catch (err) {
        console.error(`[interactionCreate] ❌ Channel select threw for "${interaction.customId}":`, err);
        await safeErrorReply(interaction);
      }
      return;
    }

    // ----------------------------------------------------------
    // ROLE SELECT MENUS (native pickers — used by /setup)
    // ----------------------------------------------------------
    if (interaction.isRoleSelectMenu()) {
      try {
        if (interaction.customId.startsWith("dset_")) {
          const cmd = client.commands.get("setup");
          if (!cmd?.roleSelectHandler) return commandNotLoadedReply(interaction, "setup");
          return await cmd.roleSelectHandler(interaction);
        }
        console.warn(`[interactionCreate] ⚠️ Unhandled role select ID: ${interaction.customId}`);
      } catch (err) {
        console.error(`[interactionCreate] ❌ Role select threw for "${interaction.customId}":`, err);
        await safeErrorReply(interaction);
      }
      return;
    }

    // ----------------------------------------------------------
    // MODAL SUBMISSIONS
    // ----------------------------------------------------------
    if (interaction.isModalSubmit()) {
      console.log(`[interactionCreate] 📝 Modal: ${interaction.customId} from ${interaction.user.tag}`);

      try {

        // Court request modals
        if (
          interaction.customId.startsWith("court_request_modal_") ||
          interaction.customId.startsWith("close_court_request_modal_")
        ) {
          const cmd = client.commands.get("courtrequest");
          if (!cmd?.modalHandler) return commandNotLoadedReply(interaction, "courtrequest");
          return await cmd.modalHandler(interaction);
        }

        // Application modals
        if (
          interaction.customId.startsWith("application_modal_") ||
          interaction.customId.startsWith("close_reason_modal_")
        ) {
          const cmd = client.commands.get("application");
          if (!cmd?.modalHandler) return commandNotLoadedReply(interaction, "application");
          return await cmd.modalHandler(interaction);
        }

        // Onboarding config modals (add-channel title + info)
        if (interaction.customId.startsWith("onbcfg|")) {
          const cmd = client.commands.get("onboarding");
          if (!cmd?.modalHandler) return commandNotLoadedReply(interaction, "onboarding");
          return await cmd.modalHandler(interaction);
        }

        // Stock market modals (buy, list shares, sell quantity)
        if (
          interaction.customId.startsWith("stock_buy_modal_") ||
          interaction.customId.startsWith("stock_listqty_") ||
          interaction.customId.startsWith("stock_sellqty_")
        ) {
          const cmd = client.commands.get("stock");
          if (!cmd?.modalHandler) return commandNotLoadedReply(interaction, "stock");
          return await cmd.modalHandler(interaction);
        }

        // ── /setup dashboard modals ──
        if (interaction.customId.startsWith("dset_")) {
          const cmd = client.commands.get("setup");
          if (!cmd?.modalHandler) return commandNotLoadedReply(interaction, "setup");
          return await cmd.modalHandler(interaction);
        }

        console.warn(`[interactionCreate] ⚠️ Unhandled modal ID: ${interaction.customId}`);

      } catch (err) {
        console.error(`[interactionCreate] ❌ Modal handler threw for "${interaction.customId}":`, err);
        await safeErrorReply(interaction);
      }

      return;
    }

    // ----------------------------------------------------------
    // SLASH COMMANDS
    // ----------------------------------------------------------
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        console.warn(`[interactionCreate] ⚠️ No command found: ${interaction.commandName}`);
        return interaction.reply({ content: "❌ Command not found!", ephemeral: true });
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`[interactionCreate] ❌ Error executing /${interaction.commandName}:`, error);
        const errorMessage = { content: "❌ An error occurred while executing this command.", ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage).catch(() => {});
        } else {
          await interaction.reply(errorMessage).catch(() => {});
        }
      }
    }
  },
};
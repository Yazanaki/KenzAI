// modules/stock/stock.js
// /stock command: clan owners post a market embed (with a generated price
// chart) that lets investors buy/sell shares, paid for with real in-game
// Minecraft money sent to DEMXN13. See modules/stock/stocklogic.js for the
// treasury/holdings math and modules/stock/pendingOrders.js for the 60s
// buy-verification window.

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const path = require("path");
const fs = require("fs");
const { readClans } = require("../database/clansPersistence");
const { readMembers } = require("../database/membersPersistence");
const { stores } = require("../database/stores");
const stocklogic = require("./stocklogic");
const pendingOrders = require("./pendingOrders");
const investorRole = require("./investorRole");
const { renderStockChart, renderStockLineChart, MAX_VISIBLE_CANDLES } = require("./chart");
const donutsmp = require("../servers/donutsmp");
const { num } = require("../servers/serverembed");
const {
  createMarketEmbed,
  createMarketButtons,
  createPortfolioEmbed,
  createSellPositionMenu,
  cooldownNote,
} = require("./stockembed");

const CHART_ATTACHMENT_NAME = "stockchart.png";
const EMBLEMS_DIR = path.join(__dirname, "..", "images", "clanemblems");

// /stock post is usable by a clan's own Discord owner OR anyone holding the
// "Royalty" status role in the main Yazanaki Empire server. The role ID is
// read live from roles.json (by name) with a known fallback — same lookup
// used by modules/activity/activity.js and modules/clantracking/clan.js.
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";
const ROYALTY_ROLE_FALLBACK_ID = "1334642034472128654";

function getRoyaltyRoleId() {
  try {
    const rolesConfig = stores.roles_config.readObject();
    const statusRoles = rolesConfig?.guilds?.[YAZANAKI_EMPIRE_GUILD_ID]?.statusRoles || {};
    const entry = Object.entries(statusRoles).find(([, r]) => r?.name === "Royalty");
    if (entry) return entry[0];
  } catch (err) {
    console.warn("[stock] ⚠️ Could not read roles config for Royalty role:", err.message);
  }
  return ROYALTY_ROLE_FALLBACK_ID;
}

/** True if the user holds the Royalty role in the Yazanaki Empire server. */
async function isYazanakiRoyalty(client, discordId) {
  const guild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
  if (!guild) return false;
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return false;
  return member.roles.cache.has(getRoyaltyRoleId());
}

/** Absolute path to a clan's emblem PNG, or null if it doesn't exist. */
function getEmblemPath(abbr) {
  if (!abbr) return null;
  const p = path.join(EMBLEMS_DIR, `${abbr.toUpperCase()}.png`);
  return fs.existsSync(p) ? p : null;
}

/**
 * The clan owner's Minecraft IGN, looked up from the member module by their
 * Discord ID (the guild owner). Investors pay this account. null if the owner
 * isn't a linked member.
 */
async function getClanOwnerIgn(client, guildId) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ownerId: null, ign: null };
  const ownerId = guild.ownerId;
  const members = readMembers();
  const m = members[ownerId];
  return { ownerId, ign: m ? (m.minecraftUser || null) : null };
}

const REASON_MESSAGES = {
  clan_not_registered: "This server isn't a registered Yazanaki Empire clan. Use `/clan add` first.",
  no_server_linked: "This clan isn't linked to a Minecraft server yet. Use `/clan edit server:donutsmp` first.",
  no_server_price_configured: "The linked server has no share price configured yet — ask staff to set one.",
};

function replyReason(interaction, reason, fallback = "Something went wrong.") {
  return interaction.reply({
    content: `❌ ${REASON_MESSAGES[reason] || fallback}`,
    flags: MessageFlags.Ephemeral,
  });
}

// ---- Shared market view builder (used by /stock post and the toggle button) ----

/**
 * Build the { embeds, files, components } payload for a clan's market post
 * in the given chart mode. Shared by handlePost and the toggle button so
 * both render from the exact same data/embed/button logic.
 * @param {object} clan
 * @param {object} stock
 * @param {"ohlc"|"line"} mode
 */
async function buildMarketView(clan, stock, mode, client) {
  const visible = (stock.candles || []).slice(-MAX_VISIBLE_CANDLES);
  const priceChange = stocklogic.computePriceChange(visible);
  const serverLabel = stock.server === "donutsmp" ? "DonutSMP" : stock.server;

  const chartOpts = {
    clanAbbr: clan.abbr,
    serverLabel,
    currentPrice: stock.currentPrice,
    priceChange,
    emblemPath: getEmblemPath(clan.abbr),
  };
  const chartBuffer = mode === "line"
    ? await renderStockLineChart(stock.candles, chartOpts)
    : await renderStockChart(stock.candles, chartOpts);

  const attachment = new AttachmentBuilder(chartBuffer, { name: CHART_ATTACHMENT_NAME });
  const ownerInfo = client ? await getClanOwnerIgn(client, stock.guildId) : { ign: null };
  const embed = createMarketEmbed(clan, stock, CHART_ATTACHMENT_NAME, priceChange, {
    ownerHolding: stocklogic.getOwnerHolding(stock),
    ownerIgn: ownerInfo.ign,
  });
  const buttons = createMarketButtons(stock.guildId, mode);

  return { embeds: [embed], files: [attachment], components: [buttons] };
}

/**
 * Re-render an already-posted market message in place so it reflects fresh
 * stock state (new price, reduced treasury, updated chart) right after a
 * trade. Preserves whichever chart mode the message is currently showing.
 * @param {import("discord.js").Message} message - the market post message
 * @param {string} guildId
 */
async function refreshMarketMessage(message, guildId) {
  if (!message) return;
  const clans = readClans();
  const clan = clans[guildId];
  const stock = stocklogic.getStockRecord(guildId);
  if (!clan || !stock) return;

  // The toggle button's customId is stock_toggle_<nextMode>_<guildId>, so the
  // mode currently on screen is the opposite of that "next" mode.
  let mode = "ohlc";
  for (const row of message.components || []) {
    for (const comp of row.components || []) {
      const cid = comp.customId || comp.custom_id || "";
      if (cid.startsWith("stock_toggle_")) {
        const nextMode = cid.slice("stock_toggle_".length).split("_")[0];
        mode = nextMode === "line" ? "ohlc" : "line";
      }
    }
  }

  const payload = await buildMarketView(clan, stock, mode, message.client);
  // attachments: [] drops the stale chart image so the new one replaces it.
  await message.edit({ ...payload, attachments: [] })
    .then(() => console.log(`[stock] 🔄 Refreshed market message for ${clan.abbr} (${guildId}) after trade`))
    .catch((err) => console.warn(`[stock] ⚠️ Could not refresh market message: ${err.message}`));
}

// ---- /stock post ---------------------------------------------------------

async function handlePost(interaction) {
  console.log(`[stock] 📊 /stock post by ${interaction.user.tag} (${interaction.user.id}) in guild ${interaction.guild?.id}`);

  if (!interaction.guild) {
    return interaction.reply({ content: "❌ This command only works in a clan's Discord server.", flags: MessageFlags.Ephemeral });
  }

  const isOwner = interaction.user.id === interaction.guild.ownerId;
  const allowed = isOwner || await isYazanakiRoyalty(interaction.client, interaction.user.id);
  if (!allowed) {
    console.log(`[stock] 🚫 /stock post denied — ${interaction.user.id} is not owner of ${interaction.guild.id} nor Yazanaki Royalty`);
    return interaction.reply({ content: "❌ Only this clan's Discord owner or Yazanaki Empire Royalty can post the stock market.", flags: MessageFlags.Ephemeral });
  }

  const result = stocklogic.getOrCreateStockRecord(interaction.guild.id);
  if (!result.success) {
    console.log(`[stock] ⚠️ /stock post could not build market for ${interaction.guild.id}: ${result.reason}`);
    return replyReason(interaction, result.reason);
  }

  const payload = await buildMarketView(result.clan, result.stock, "ohlc", interaction.client);
  console.log(`[stock] ✅ Posted ${result.clan.abbr} market (price ${result.stock.currentPrice}, for sale ${result.stock.sharesForSale})`);
  await interaction.reply(payload);

  // Remember where this post lives so trades can refresh it in place later
  // (e.g. a sell confirmed from the owner's DM, which has no direct handle).
  try {
    const msg = await interaction.fetchReply();
    const stock = stocklogic.getStockRecord(interaction.guild.id);
    if (stock && msg) {
      stock.lastPost = { channelId: msg.channelId, messageId: msg.id };
      stocklogic.saveStockRecord(interaction.guild.id, stock);
    }
  } catch (err) {
    console.warn(`[stock] ⚠️ Could not record market post location: ${err.message}`);
  }
}

/** Refresh the last-posted market message for a guild via its stored ref. */
async function refreshMarketByRef(client, guildId) {
  const stock = stocklogic.getStockRecord(guildId);
  if (!stock || !stock.lastPost) return;
  const { channelId, messageId } = stock.lastPost;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.messages) return;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) await refreshMarketMessage(message, guildId);
  } catch (err) {
    console.warn(`[stock] ⚠️ Could not refresh stored market message for ${guildId}: ${err.message}`);
  }
}

// ---- Toggle chart style ---------------------------------------------------

async function handleToggle(interaction, mode, guildId) {
  console.log(`[stock] 🔄 Chart toggle to "${mode}" for ${guildId} by ${interaction.user.tag}`);
  const clans = readClans();
  const clan = clans[guildId];
  const stock = stocklogic.getStockRecord(guildId);

  if (!clan || !stock) {
    return interaction.reply({ content: "❌ This clan's stock market isn't set up yet.", flags: MessageFlags.Ephemeral });
  }

  const payload = await buildMarketView(clan, stock, mode, interaction.client);
  return interaction.update(payload);
}

// ---- /stock portfolio -----------------------------------------------------

/** Clans the given user owns (as guild owner) with their derived holding. */
function getOwnerHoldings(client, userId) {
  const all = stores.clan_stocks.readMap();
  const out = [];
  for (const gid of Object.keys(all)) {
    const stock = all[gid];
    const guild = client.guilds.cache.get(gid);
    if (!guild || guild.ownerId !== userId) continue;
    const ownerHolding = stocklogic.getOwnerHolding(stock);
    if (ownerHolding <= 0) continue;
    const currentPrice = Number(stock.currentPrice) || 0;
    out.push({
      guildId: gid,
      ownerHolding,
      sharesForSale: Number(stock.sharesForSale) || 0,
      currentPrice,
      marketValue: ownerHolding * currentPrice,
    });
  }
  return out;
}

async function handlePortfolio(interaction) {
  const positions = stocklogic.getUserPositions(interaction.user.id);
  const ownerHoldings = getOwnerHoldings(interaction.client, interaction.user.id);
  console.log(`[stock] 📁 /stock portfolio by ${interaction.user.tag} — ${positions.length} position(s), ${ownerHoldings.length} owned clan(s)`);
  const clans = readClans();
  const embed = createPortfolioEmbed(positions, clans, { ownerHoldings });
  const note = cooldownNote(positions);
  if (note) embed.setFooter({ text: note });

  const components = [];
  const sellMenu = createSellPositionMenu(positions, clans);
  if (sellMenu) components.push(sellMenu);

  return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

// ---- Buttons --------------------------------------------------------------

function buildBuyModal(guildId) {
  return new ModalBuilder()
    .setCustomId(`stock_buy_modal_${guildId}`)
    .setTitle("Buy Clan Stock")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("ign")
          .setLabel("Your Minecraft Username (IGN)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g., Notch")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("shares")
          .setLabel("How many shares to buy")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g., 5")
      )
    );
}

/** Modal for the clan owner to list some of their shares for sale. */
function buildListModal(guildId, available) {
  return new ModalBuilder()
    .setCustomId(`stock_listqty_${guildId}`)
    .setTitle("List shares for sale")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel(`How many to list (you have ${available})`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder(String(available))
      )
    );
}

/** Modal for an investor to sell some shares from a position. */
function buildSellQtyModal(positionId, sellable) {
  return new ModalBuilder()
    .setCustomId(`stock_sellqty_${positionId}`)
    .setTitle("Sell shares")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("qty")
          .setLabel(`How many to sell (max ${sellable})`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder(String(sellable))
      )
    );
}

/** Show the user their positions in one clan with a per-position sell menu. */
async function handleSellButton(interaction, guildId) {
  const clans = readClans();
  const positions = stocklogic.getUserPositionsInClan(guildId, interaction.user.id);
  const abbr = clans[guildId]?.abbr || "this clan";
  console.log(`[stock] 🧾 Sell picker opened by ${interaction.user.tag} for ${guildId} — ${positions.length} position(s)`);

  const embed = createPortfolioEmbed(positions, clans, {
    title: `📉 Sell your ${abbr} positions`,
    scopeNote: `You don't own any ${abbr} positions to sell yet.`,
  });
  const note = cooldownNote(positions);
  if (note) embed.setFooter({ text: note });

  const components = [];
  const sellMenu = createSellPositionMenu(positions, clans);
  if (sellMenu) components.push(sellMenu);

  return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

async function buttonHandler(interaction) {
  // Button customIds only (modal SUBMISSIONS are routed to modalHandler by
  // interactionCreate.js's isModalSubmit() branch, never here).
  if (interaction.customId.startsWith("stock_markpaid_")) {
    return handleMarkPaid(interaction);
  }

  const toggleMatch = interaction.customId.match(/^stock_toggle_(ohlc|line)_(\d+)$/);
  if (toggleMatch) {
    return handleToggle(interaction, toggleMatch[1], toggleMatch[2]);
  }

  if (interaction.customId.startsWith("stock_buy_")) {
    const guildId = interaction.customId.slice("stock_buy_".length);
    return interaction.showModal(buildBuyModal(guildId));
  }

  if (interaction.customId.startsWith("stock_sell_")) {
    const guildId = interaction.customId.slice("stock_sell_".length);
    // The clan owner uses Sell to LIST shares; everyone else sells positions.
    if (interaction.guild && interaction.user.id === interaction.guild.ownerId) {
      const stock = stocklogic.getStockRecord(guildId);
      if (!stock) return interaction.reply({ content: "❌ This clan's stock isn't set up yet — run `/stock post` first.", flags: MessageFlags.Ephemeral });
      const available = stocklogic.getOwnerUnlisted(stock);
      if (available <= 0) return interaction.reply({ content: "❌ You have no unlisted shares to put up for sale right now.", flags: MessageFlags.Ephemeral });
      return interaction.showModal(buildListModal(guildId, available));
    }
    return handleSellButton(interaction, guildId);
  }
}

/** Select-menu handler: an investor picked a position → ask how many to sell. */
async function selectMenuHandler(interaction) {
  if (interaction.customId !== "stock_sellpos") return;

  const positionId = interaction.values?.[0];
  const position = stocklogic.getPosition(positionId);
  if (!position || position.discordId !== interaction.user.id) {
    return interaction.reply({ content: "❌ That position no longer exists or isn't yours.", flags: MessageFlags.Ephemeral });
  }

  const cooldown = stocklogic.getPositionCooldownRemaining(position);
  if (cooldown > 0) {
    return interaction.reply({ content: `⏳ You bought this too recently — it must be held a bit before selling. Try again in **${formatDuration(cooldown)}**.`, flags: MessageFlags.Ephemeral });
  }

  const sellable = (Number(position.shares) || 0) - (Number(position.pendingShares) || 0);
  if (sellable <= 0) {
    return interaction.reply({ content: "❌ That position has no sellable shares left (already pending sale).", flags: MessageFlags.Ephemeral });
  }

  return interaction.showModal(buildSellQtyModal(positionId, sellable));
}

/** Investor submitted how many shares of a position to sell. */
async function handleSellQtyModal(interaction, positionId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const qty = parseShares(interaction.fields.getTextInputValue("qty"));
  if (!qty) return interaction.editReply({ content: "❌ Enter a whole number of shares greater than 0." });

  const result = stocklogic.createPendingSellForPosition(positionId, interaction.user.id, qty);
  if (!result.success) {
    const messages = {
      not_found: "❌ That position no longer exists or isn't yours.",
      no_stock_record: "❌ This clan's stock isn't set up right now.",
      bad_qty: "❌ Enter a whole number of shares greater than 0.",
      too_many: `❌ You can only sell up to **${(result.sellable || 0).toLocaleString()}** share(s) from that position.`,
      cooldown: `⏳ It must be held a bit before selling — try again in **${formatDuration(result.cooldownMs || 0)}**.`,
    };
    return interaction.editReply({ content: messages[result.reason] || "❌ Couldn't place that sell order." });
  }

  const clans = readClans();
  const clan = clans[result.guildId];
  const abbr = clan?.abbr || "the clan";
  const feePct = (stocklogic.TAX_RATE * 100).toFixed(0);
  const pnl = result.payout - (result.soldBuyCost || 0);
  const pnlText = `${pnl >= 0 ? "🔺 +" : "🔻 "}${pnl.toLocaleString()}`;

  await interaction.editReply({
    content:
      `📉 Sell order placed for **${result.shares.toLocaleString()}** share(s) of **${abbr}**.\n` +
      `You'll receive \`${result.payout.toLocaleString()}\` — \`${result.grossPayout.toLocaleString()}\` minus a ` +
      `\`${result.tax.toLocaleString()}\` (${feePct}%) fee. P/L vs. what you paid: ${pnlText}.\n` +
      `${abbr}'s clan owner has been notified to pay you in-game — they'll confirm once it's sent.`,
  });

  await notifyOwnerOfSell(interaction.client, result.guildId, {
    txId: result.txId,
    shares: result.shares,
    payout: result.payout,
    sellerTag: interaction.user.tag,
  }, clan);
}

/** Clan owner submitted how many shares to list for sale. */
async function handleListQtyModal(interaction, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.guild || interaction.user.id !== interaction.guild.ownerId) {
    return interaction.editReply({ content: "❌ Only this clan's Discord owner can list shares for sale." });
  }
  const amount = parseShares(interaction.fields.getTextInputValue("amount"));
  if (!amount) return interaction.editReply({ content: "❌ Enter a whole number of shares greater than 0." });

  const result = stocklogic.listShares(guildId, amount);
  if (!result.success) {
    if (result.reason === "nothing_to_list") {
      return interaction.editReply({ content: `❌ You have no unlisted shares to put up for sale (available: ${(result.available || 0).toLocaleString()}).` });
    }
    return interaction.editReply({ content: "❌ This clan's stock isn't set up yet." });
  }

  await interaction.editReply({ content: `✅ Listed **${result.listed.toLocaleString()}** share(s) for sale — **${result.sharesForSale.toLocaleString()}** now available for investors to buy.` });
  // The Sell button lives on the market post, so interaction.message is it.
  if (interaction.message) {
    await refreshMarketMessage(interaction.message, guildId).catch(() => {});
  } else {
    await refreshMarketByRef(interaction.client, guildId).catch(() => {});
  }
}

/** DM the clan owner a Mark-Paid prompt for a pending sell. */
async function notifyOwnerOfSell(client, guildId, info, clan) {
  const abbr = clan?.abbr || guildId;
  const feePct = (stocklogic.TAX_RATE * 100).toFixed(0);
  const clanGuild = await client.guilds.fetch(guildId).catch(() => null);
  const owner = clanGuild ? await clanGuild.fetchOwner().catch(() => null) : null;
  const pending = stocklogic.getPendingSell(info.txId);
  const ign = pending?.ign || "unknown";

  if (!owner) {
    console.warn(`[stock] ⚠️ No owner reachable to notify for pending sell ${info.txId} (guild ${guildId})`);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📉 Pending Sell — ${abbr}`)
    .setColor(0xed4245)
    .setDescription(
      `**${info.sellerTag}** (IGN: \`${ign}\`) is closing a position of **${info.shares.toLocaleString()}** share(s).\n` +
      `Pay them \`${info.payout.toLocaleString()}\` in-game (net of the ${feePct}% fee), then click below to confirm.`
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stock_markpaid_${guildId}_${info.txId}`)
      .setLabel("Mark Paid")
      .setStyle(ButtonStyle.Success)
  );
  await owner.send({ embeds: [embed], components: [row] })
    .then(() => console.log(`[stock] 📨 DM'd owner ${owner.id} to confirm pending sell ${info.txId}`))
    .catch(() => console.warn(`[stock] ⚠️ Could not DM clan owner ${owner.id} about pending sell ${info.txId}`));
}

async function handleMarkPaid(interaction) {
  const rest = interaction.customId.slice("stock_markpaid_".length);
  const sepIndex = rest.indexOf("_");
  const guildId = rest.slice(0, sepIndex);
  const txId = rest.slice(sepIndex + 1);

  console.log(`[stock] 💵 Mark-paid clicked by ${interaction.user.tag} (${interaction.user.id}) for tx ${txId} (guild ${guildId})`);

  const clanGuild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  if (!clanGuild) {
    return interaction.reply({ content: "❌ Couldn't find that clan's Discord server anymore.", flags: MessageFlags.Ephemeral });
  }

  if (interaction.user.id !== clanGuild.ownerId) {
    console.log(`[stock] 🚫 Mark-paid denied — ${interaction.user.id} is not owner of ${guildId}`);
    return interaction.reply({ content: "❌ Only this clan's Discord owner can confirm a sell payout.", flags: MessageFlags.Ephemeral });
  }

  const result = stocklogic.markSellPaid(txId);
  if (!result.success) {
    return interaction.reply({ content: "❌ This sell order was already confirmed or no longer exists.", flags: MessageFlags.Ephemeral });
  }

  // Revoke the INVESTOR role only once the seller has NO positions left in this clan.
  await investorRole.revokeInvestorRoleIfZero(clanGuild, result.discordId, result.remainingPositions);

  await interaction.reply({ content: "✅ Sell order marked as paid. The shares returned to your holding — you can re-list them with **Sell**.", flags: MessageFlags.Ephemeral });

  if (interaction.message?.editable) {
    await interaction.message.edit({ components: [] }).catch(() => {});
  }

  // Refresh the public market post so the returned shares / new price show.
  await refreshMarketByRef(interaction.client, guildId).catch(() => {});
}

// ---- Modals -----------------------------------------------------------

function parseShares(raw) {
  const n = parseInt(String(raw).trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Human-friendly "2h 5m" / "45m" from a millisecond duration. */
function formatDuration(ms) {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

async function handleBuyModal(interaction, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ign = interaction.fields.getTextInputValue("ign").trim();
  const shares = parseShares(interaction.fields.getTextInputValue("shares"));

  console.log(`[stock] 🛒 BUY request: ${interaction.user.tag} (${interaction.user.id}) wants ${shares ?? "?"} share(s) of ${guildId} as IGN "${ign}"`);

  if (!shares) {
    return interaction.editReply({ content: "❌ Enter a whole number of shares greater than 0." });
  }

  if (pendingOrders.hasPendingBuy(guildId, interaction.user.id)) {
    console.log(`[stock] ⏳ BUY blocked — ${interaction.user.id} already has a pending order on ${guildId}`);
    return interaction.editReply({ content: "⏳ You already have a pending buy order — wait for it to resolve or expire (60s)." });
  }

  const clans = readClans();
  const clan = clans[guildId];
  const stock = stocklogic.getStockRecord(guildId);
  if (!clan || !stock) {
    return interaction.editReply({ content: "❌ This clan's stock isn't set up yet." });
  }

  // Investors pay the CLAN OWNER — look up their linked Minecraft account.
  const ownerInfo = await getClanOwnerIgn(interaction.client, guildId);
  if (!ownerInfo.ign) {
    return interaction.editReply({ content: `❌ ${clan.abbr}'s clan owner hasn't linked a Minecraft account, so there's no one to pay yet. Buying is disabled until they link it.` });
  }
  const payeeIgn = ownerInfo.ign;

  const { base, tax, total: cost } = stocklogic.computeBuyCost(shares, stock.currentPrice);
  const feePct = (stocklogic.TAX_RATE * 100).toFixed(0);

  const reserve = stocklogic.reserveSaleShares(guildId, shares);
  if (!reserve.success) {
    return interaction.editReply({ content: `❌ Only **${(reserve.available || 0).toLocaleString()}** share(s) are currently listed for sale.` });
  }

  const statsRes = await donutsmp.getPlayerStats(ign).catch(() => ({ ok: false }));
  if (!statsRes.ok) {
    console.log(`[stock] ❌ BUY aborted — could not fetch DonutSMP stats for "${ign}"; refunding ${shares} reserved share(s)`);
    stocklogic.refundSaleShares(guildId, shares);
    return interaction.editReply({ content: `❌ Couldn't find \`${ign}\` on DonutSMP. Double-check the spelling and try again.` });
  }

  const baselineMoney = num(statsRes.stats?.money);
  console.log(`[stock] ⏱️ BUY watch started for ${interaction.user.id} (${ign}) → pay ${payeeIgn}: total ${cost} (base ${base} + ${feePct}% fee ${tax}), baseline balance ${baselineMoney}, 60s window`);

  await interaction.editReply({
    content:
      `💳 Send exactly \`${cost.toLocaleString()}\` to **${payeeIgn}** in-game ` +
      `(e.g. \`/pay ${payeeIgn} ${cost}\`) within **60 seconds**.\n` +
      `That's \`${base.toLocaleString()}\` for **${shares}** share(s) + a \`${tax.toLocaleString()}\` (${feePct}%) transaction fee.\n` +
      `Don't make any other purchases or payments during this window — the bot confirms ` +
      `your order by watching \`${ign}\`'s own balance drop by that amount.`,
  });

  pendingOrders.startBuyWatch(
    { guildId, discordId: interaction.user.id, ign, shares, cost, baselineMoney },
    {
      onConfirmed: async () => {
        stocklogic.completeBuy({ guildId, discordId: interaction.user.id, ign, shares, pricePerShare: stock.currentPrice, paid: cost });

        let roleNote = "";
        const clanGuild = await interaction.client.guilds.fetch(guildId).catch(() => null);
        if (clanGuild) {
          const granted = await investorRole.grantInvestorRole(clanGuild, interaction.user.id);
          if (!granted.success && granted.reason === "not_in_guild") {
            roleNote = clan.invite
              ? `\n\nJoin ${clan.abbr}'s Discord to receive your INVESTOR role: ${clan.invite}`
              : `\n\nAsk a ${clan.abbr} officer for a Discord invite to receive your INVESTOR role.`;
          } else if (!granted.success) {
            roleNote = "\n\n⚠️ Couldn't grant the INVESTOR role automatically — ask a clan officer.";
          }
        }

        await interaction.editReply({
          content: `✅ Payment confirmed! You now own **${shares}** more share(s) of **${clan.abbr}**.${roleNote}`,
        }).catch(() => {});

        // Update the public market post in place so the new price / reduced
        // shares available show immediately. interaction.message is the exact
        // post the Buy button lives on; fall back to the stored ref if absent.
        if (interaction.message) {
          await refreshMarketMessage(interaction.message, guildId).catch(() => {});
        } else {
          await refreshMarketByRef(interaction.client, guildId).catch(() => {});
        }
      },
      onTimeout: async () => {
        stocklogic.refundSaleShares(guildId, shares);
        await interaction.editReply({
          content: "⌛ No matching payment detected within 60 seconds. No shares were purchased — feel free to try again.",
        }).catch(() => {});
      },
    }
  );
}

async function modalHandler(interaction) {
  if (interaction.customId.startsWith("stock_buy_modal_")) {
    const guildId = interaction.customId.slice("stock_buy_modal_".length);
    return handleBuyModal(interaction, guildId);
  }
  if (interaction.customId.startsWith("stock_listqty_")) {
    const guildId = interaction.customId.slice("stock_listqty_".length);
    return handleListQtyModal(interaction, guildId);
  }
  if (interaction.customId.startsWith("stock_sellqty_")) {
    const positionId = interaction.customId.slice("stock_sellqty_".length);
    return handleSellQtyModal(interaction, positionId);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Clan stock market")
    .addSubcommand((sub) =>
      sub.setName("post").setDescription("Post this clan's stock market (clan Discord owner only)")
    )
    .addSubcommand((sub) =>
      sub.setName("portfolio").setDescription("View your stock holdings across all clans")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "post") return handlePost(interaction);
    if (sub === "portfolio") return handlePortfolio(interaction);
  },

  buttonHandler,
  modalHandler,
  selectMenuHandler,
};

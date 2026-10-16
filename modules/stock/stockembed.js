// modules/stock/stockembed.js
// Embed builders for the clan stock market (/stock post, /stock portfolio).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const { formatMoney } = require("../servers/serverembed");
const { TAX_RATE, SELL_COOLDOWN_MS } = require("./stocklogic");

function holdPeriodLabel() {
  const min = Math.round(SELL_COOLDOWN_MS / 60000);
  if (min <= 0) return null;
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

const UP_EMBED_COLOR = 0x0a0a0a;   // near-black (pure 0x000000 is treated as "no color" by Discord)
const DOWN_EMBED_COLOR = 0xd40000; // red

/**
 * Public market post. The clan owner is the market maker: they hold all
 * shares, list some for sale, and investors buy those from them.
 * @param {object} clan
 * @param {object} stock
 * @param {string} chartAttachmentName
 * @param {{ absolute, percent, direction }} priceChange
 * @param {{ ownerHolding, ownerIgn }} [ctx]
 */
function createMarketEmbed(clan, stock, chartAttachmentName, priceChange, ctx = {}) {
  const currencyLabel = stock.server === "donutsmp" ? "DonutSMP money" : stock.server;
  const sharesForSale = Number(stock.sharesForSale) || 0;
  const outstanding = Number(stock.outstandingShares) || 0;
  const ownerHolding = Number(ctx.ownerHolding) || 0;      // total the owner owns
  const ownerKept = Math.max(0, ownerHolding - sharesForSale); // not listed for sale
  const investorHeld = Math.max(0, outstanding - ownerHolding);

  const change = priceChange || { absolute: 0, percent: 0, direction: "flat" };
  const arrow = change.direction === "down" ? "🔻" : change.direction === "up" ? "🔺" : "▪️";
  const sign = change.absolute > 0 ? "+" : "";
  const changeText = `${arrow} ${sign}${formatMoney(change.absolute)} (${sign}${change.percent.toFixed(2)}%)`;

  const payValue = ctx.ownerIgn
    ? `Buyers pay **${clan.abbr}'s owner** in-game: **${ctx.ownerIgn}**. ` +
      `Click **Buy**, enter your Minecraft IGN and share count, then \`/pay ${ctx.ownerIgn} <amount>\` within 60 seconds ` +
      `— the bot verifies it by watching your own balance drop by that amount.`
    : `⚠️ ${clan.abbr}'s owner hasn't linked a Minecraft account yet, so buying is disabled until they do.`;

  const embed = new EmbedBuilder()
    .setTitle(`📈 ${clan.abbr} Stock Market`)
    .setColor(change.direction === "down" ? DOWN_EMBED_COLOR : UP_EMBED_COLOR)
    .setDescription(
      `**${clan.name}**'s clan stock. The clan owner holds every share and lists some for sale — ` +
      `investors buy those and pay the owner directly.`
    )
    .addFields(
      { name: "💰 Price per share", value: `\`${formatMoney(stock.currentPrice)}\` ${currencyLabel}`, inline: false },
      { name: "📈 Price change", value: changeText, inline: false },
      { name: "🛒 For sale (buy these)", value: `\`${sharesForSale.toLocaleString()}\``, inline: false },
      { name: "👑 Owner keeps (not for sale)", value: `\`${ownerKept.toLocaleString()}\``, inline: false },
      { name: "👥 Held by investors", value: `\`${investorHeld.toLocaleString()}\``, inline: false },
      { name: "📊 Total shares", value: `\`${outstanding.toLocaleString()}\``, inline: false },
      { name: "💳 How to buy", value: payValue, inline: false },
      {
        name: "ℹ️ Fees & rules",
        value:
          `A **${(TAX_RATE * 100).toFixed(0)}%** fee applies to buys and sells (kept by the clan owner)` +
          (holdPeriodLabel() ? `, and shares must be held for **${holdPeriodLabel()}** before they can be sold.` : ".") +
          `\nConfirmed investors get the **INVESTOR** role. The owner uses **Sell** to list more shares.`,
        inline: false,
      }
    )
    .setFooter({ text: "Use /stock portfolio to view or sell your positions." });

  if (chartAttachmentName) {
    embed.setImage(`attachment://${chartAttachmentName}`);
  }

  return embed;
}

/**
 * @param {string} guildId
 * @param {"ohlc"|"line"} mode - the chart style currently being displayed
 */
function createMarketButtons(guildId, mode = "ohlc") {
  const nextMode = mode === "ohlc" ? "line" : "ohlc";
  const toggleLabel = mode === "ohlc" ? "View Line Chart" : "View OHLC Chart";

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stock_buy_${guildId}`)
      .setLabel("Buy")
      .setStyle(ButtonStyle.Success)
      .setEmoji("📈"),
    new ButtonBuilder()
      .setCustomId(`stock_sell_${guildId}`)
      .setLabel("Sell")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("📉"),
    new ButtonBuilder()
      .setCustomId(`stock_toggle_${nextMode}_${guildId}`)
      .setLabel(toggleLabel)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔄")
  );
}

function clanLabel(clansById, guildId) {
  const clan = clansById[guildId];
  return clan ? `${clan.abbr}` : guildId;
}

function durationLabel(ms) {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Ephemeral view of a member's positions (each buy is its own line). Shared by
 * /stock portfolio (all clans) and the market Sell button (one clan).
 * @param {Array} positions - enriched positions from stocklogic.getUserPositions
 * @param {object} clansById
 * @param {{ title?: string, scopeNote?: string }} [opts]
 */
function createPortfolioEmbed(positions, clansById, opts = {}) {
  const ownerHoldings = opts.ownerHoldings || [];
  const embed = new EmbedBuilder()
    .setTitle(opts.title || "📊 Your Stock Portfolio")
    .setColor(UP_EMBED_COLOR);

  if (!positions.length && !ownerHoldings.length) {
    embed.setDescription(opts.scopeNote || "You don't own any clan stock yet. Find a clan's `/stock` post to invest!");
    return embed;
  }

  // Owner holdings first — the clan's shares you own as its owner.
  const ownerFields = ownerHoldings.slice(0, 10).map((oh) => {
    const kept = Math.max(0, oh.ownerHolding - oh.sharesForSale);
    return {
      name: `👑 ${clanLabel(clansById, oh.guildId)} — your clan (owner)`,
      value:
        `You own \`${oh.ownerHolding.toLocaleString()}\` shares · worth \`${formatMoney(oh.marketValue)}\` @ \`${formatMoney(oh.currentPrice)}\`\n` +
        `\`${oh.sharesForSale.toLocaleString()}\` listed for sale · \`${kept.toLocaleString()}\` kept — use **Sell** on the market post to list more.`,
      inline: false,
    };
  });

  if (!positions.length) {
    embed.addFields(ownerFields);
    embed.setDescription("You don't hold any *bought* positions, but you own your own clan's shares:");
    return embed;
  }

  let totalPaid = 0;
  let totalNet = 0;

  const fields = positions.slice(0, 25 - ownerFields.length).map((p, i) => {
    totalPaid += p.buyCost;
    totalNet += p.netIfSold;

    const up = p.pnl >= 0;
    const arrow = up ? "🔺" : "🔻";
    const sign = p.pnl > 0 ? "+" : "";
    const pendingNote = p.pendingShares > 0 ? ` ⏳ *${p.pendingShares.toLocaleString()} pending sale*` : "";

    const value = [
      `\`${p.shares.toLocaleString()}\` shares · bought @ \`${formatMoney(p.buyPricePerShare)}\``,
      `Paid: \`${formatMoney(p.buyCost)}\``,
      `Now @ \`${formatMoney(p.currentPrice)}\` → if sold: \`${formatMoney(p.netIfSold)}\``,
      `P/L: ${arrow} \`${sign}${formatMoney(p.pnl)}\` (${sign}${p.pnlPercent.toFixed(2)}%)`,
    ].join("\n");

    return { name: `#${i + 1} · Buy · ${clanLabel(clansById, p.guildId)}${pendingNote}`, value, inline: false };
  });

  embed.addFields([...ownerFields, ...fields]);

  const totalPnl = totalNet - totalPaid;
  const tUp = totalPnl >= 0;
  const tSign = totalPnl > 0 ? "+" : "";
  embed.setDescription(
    `**Total paid:** \`${formatMoney(totalPaid)}\`\n` +
    `**Value if all sold:** \`${formatMoney(totalNet)}\`\n` +
    `**Total P/L:** ${tUp ? "🔺" : "🔻"} \`${tSign}${formatMoney(totalPnl)}\``
  );

  return embed;
}

/**
 * A select menu to pick a position to sell. Only positions with sellable
 * shares (not already all-pending) that are past their hold cooldown appear.
 * Selecting one opens a quantity prompt so the investor can sell part of it.
 * @param {Array} positions - enriched positions
 * @param {object} clansById
 * @returns {ActionRowBuilder|null} null if nothing is sellable right now
 */
function createSellPositionMenu(positions, clansById) {
  const sellable = positions.filter((p) => p.sellableShares > 0 && p.cooldownMs <= 0).slice(0, 25);
  if (!sellable.length) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId("stock_sellpos")
    .setPlaceholder("Sell shares from a position…")
    .addOptions(
      sellable.map((p) => ({
        label: `${p.sellableShares.toLocaleString()} × ${clanLabel(clansById, p.guildId)} sellable (@ ${formatMoney(p.buyPricePerShare)})`.slice(0, 100),
        description: `Now worth ${formatMoney(p.netIfSold)} · P/L ${p.pnl >= 0 ? "+" : ""}${formatMoney(p.pnl)}`.slice(0, 100),
        value: p.positionId,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

/** Short note listing positions still in their hold cooldown (for context). */
function cooldownNote(positions) {
  const cooling = positions.filter((p) => p.sellableShares > 0 && p.cooldownMs > 0);
  if (!cooling.length) return null;
  return `⏳ ${cooling.length} position(s) still in their hold period and can't be sold yet (earliest in ${durationLabel(Math.min(...cooling.map((p) => p.cooldownMs)))}).`;
}

module.exports = {
  createMarketEmbed,
  createMarketButtons,
  createPortfolioEmbed,
  createSellPositionMenu,
  cooldownNote,
};

// modules/stock/stocklogic.js
// Core domain logic for the clan stock market: treasury/holdings math,
// lazy stock-record creation, resident-driven share issuance, and the
// buy/sell/transaction ledger. Mirrors modules/points/pointslogic.js's
// style (plain functions over a JSON-backed store, returning
// { success, reason } result objects).

const crypto = require("crypto");
const { stores } = require("../database/stores");
const { readClans } = require("../database/clansPersistence");
const priceEngine = require("./priceEngine");

const SHARES_PER_MEMBER = 1000;

// Price per share is a fixed business rule per Minecraft server, not an
// editable config value — currently only DonutSMP clans are live (ONF).
const SERVER_PRICE_PER_SHARE = {
  donutsmp: 100000,
};

// A flat transaction fee the CLAN OWNER keeps on every trade (they are the
// market maker — investors pay the clan owner, not the empire): buyers pay
// this much extra on top, sellers are paid this much less. It gives the clan
// owner a margin on both sides.
const TAX_RATE = 0.02;

// Minimum time a member must hold shares after their most recent buy before
// they can sell — blocks buying and immediately flipping for a profit.
// Override with STOCK_SELL_COOLDOWN_MINUTES (default 1 hour).
const SELL_COOLDOWN_MS = (() => {
  const min = parseFloat(process.env.STOCK_SELL_COOLDOWN_MINUTES);
  return Number.isFinite(min) && min >= 0 ? min * 60 * 1000 : 60 * 60 * 1000;
})();

/** Buy cost breakdown: base share value + fee the investor pays on top. */
function computeBuyCost(shares, pricePerShare) {
  const base = shares * pricePerShare;
  const tax = Math.round(base * TAX_RATE);
  return { base, tax, total: base + tax };
}

/** Sell payout breakdown: base share value − fee withheld from the payout. */
function computeSellPayout(shares, pricePerShare) {
  const base = shares * pricePerShare;
  const tax = Math.round(base * TAX_RATE);
  return { base, tax, net: base - tax };
}

function genTxId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

/** Which server key a clan is linked to. Only "donutsmp" exists today. */
function getClanServerId(clan) {
  if (clan && clan.donutsmpTeamName) return "donutsmp";
  return null;
}

/** Raw read — does NOT create a record if one doesn't exist. */
function getStockRecord(guildId) {
  const all = stores.clan_stocks.readMap();
  return all[guildId] || null;
}

function saveStockRecord(guildId, stock) {
  const all = stores.clan_stocks.readMap();
  all[guildId] = stock;
  stores.clan_stocks.writeMap(all);
  return stock;
}

/**
 * Top up treasury/outstanding shares to match the clan's current resident
 * count (1000 shares per accepted member). Safe to call repeatedly — it
 * only applies the delta since the last time it was reconciled, so shares
 * already sold to investors are never touched.
 */
function reconcileResidents(stock, clan) {
  const residents = Number(clan?.residents) || 0;
  const lastSeen = Number(stock.lastResidentsSeen) || 0;
  const delta = residents - lastSeen;
  if (delta > 0) {
    // New member shares are added to total supply — all owned by the clan
    // owner. They do NOT auto-list for sale; the owner lists what they choose.
    stock.outstandingShares = (Number(stock.outstandingShares) || 0) + delta * SHARES_PER_MEMBER;
  }
  stock.lastResidentsSeen = residents;
  return stock;
}

/**
 * Get a clan's stock record, lazily creating it (and reconciling resident
 * growth) on first access. Returns { success:false, reason } if the guild
 * isn't a registered clan or isn't linked to a supported Minecraft server.
 */
function getOrCreateStockRecord(guildId) {
  const clans = readClans();
  const clan = clans[guildId];
  if (!clan) return { success: false, reason: "clan_not_registered" };

  const serverId = getClanServerId(clan);
  if (!serverId) return { success: false, reason: "no_server_linked" };

  const basePricePerShare = SERVER_PRICE_PER_SHARE[serverId] || 0;
  if (basePricePerShare <= 0) return { success: false, reason: "no_server_price_configured" };

  let stock = getStockRecord(guildId);
  const isNew = !stock;

  if (isNew) {
    stock = {
      guildId,
      server: serverId,
      basePricePerShare,
      currentPrice: basePricePerShare,
      sharesForSale: 0,        // shares the owner has listed and are buyable now
      outstandingShares: 0,     // total supply (all owned by owner minus investor holdings)
      lastResidentsSeen: 0,
      candleIntervalMinutes: priceEngine.DEFAULT_CANDLE_INTERVAL_MINUTES,
      candles: [],
      createdAt: new Date().toISOString(),
      lastTickAt: null,
    };
  }

  if (isNew) {
    console.log(`[stocklogic] 🆕 Created stock record for ${clan.abbr} (${guildId}) on ${serverId} @ ${basePricePerShare}/share`);
  }

  const before = Number(stock.outstandingShares) || 0;
  reconcileResidents(stock, clan);
  const added = (Number(stock.outstandingShares) || 0) - before;
  if (added > 0) {
    console.log(`[stocklogic] 📈 Reconciled ${clan.abbr}: +${added} shares to owner (outstanding now ${stock.outstandingShares})`);
  }

  saveStockRecord(guildId, stock);

  return { success: true, stock, clan, isNew };
}

/** Explicit hook called right after a member is accepted into a clan. */
function onResidentAdded(guildId) {
  console.log(`[stocklogic] 👤 Resident added to clan ${guildId} — issuing ${SHARES_PER_MEMBER} shares to the owner`);
  const result = getOrCreateStockRecord(guildId);
  if (!result.success) {
    console.warn(`[stocklogic] ⚠️ Could not issue shares for ${guildId}: ${result.reason}`);
  }
  return result.success;
}

// ---- Ownership split ---------------------------------------------------
// The clan owner owns every share not held by investors. Of the owner's
// shares, `sharesForSale` are listed and buyable; the rest are unlisted.

/** Total shares currently held by investors (across all their positions). */
function getInvestorHeldTotal(guildId) {
  const all = stores.stock_holdings.readMap();
  return Object.values(all)
    .filter((p) => p && p.positionId && p.guildId === guildId)
    .reduce((sum, p) => sum + (Number(p.shares) || 0), 0);
}

/** Shares the clan owner owns (= total supply − investor holdings). */
function getOwnerHolding(stock) {
  const outstanding = Number(stock?.outstandingShares) || 0;
  return Math.max(0, outstanding - getInvestorHeldTotal(stock.guildId));
}

/** Owner shares not yet listed for sale (can still be listed). */
function getOwnerUnlisted(stock) {
  return Math.max(0, getOwnerHolding(stock) - (Number(stock.sharesForSale) || 0));
}

/**
 * Owner lists more of their shares for sale (adds to the buyable pool).
 * @returns {{ success, listed?, sharesForSale?, reason?, available? }}
 */
function listShares(guildId, amount) {
  const stock = getStockRecord(guildId);
  if (!stock) return { success: false, reason: "no_stock_record" };
  const available = getOwnerUnlisted(stock);
  const n = Math.min(Math.max(0, Math.floor(amount)), available);
  if (n <= 0) return { success: false, reason: "nothing_to_list", available };
  stock.sharesForSale = (Number(stock.sharesForSale) || 0) + n;
  // Listing adds supply to the market — nudge the price down like a sell.
  const before = stock.currentPrice;
  const after = priceEngine.applyTradeImpact(stock, "sell", n);
  saveStockRecord(guildId, stock);
  console.log(`[stocklogic] 🏷️ List: ${guildId} listed ${n} share(s) for sale (now ${stock.sharesForSale} available); price ${before} → ${after}`);
  return { success: true, listed: n, sharesForSale: stock.sharesForSale };
}

// ---- Positions ---------------------------------------------------------
// Every buy is its own POSITION (a lot): its own shares, the price it was
// bought at, the total paid (cost basis, incl. the buy fee), and when it was
// opened. Positions are shown and sold individually — closing one pays out
// that position's shares at the current market price, with its own P&L. A
// position is "open" until a sell is initiated, then "pending" until the
// owner confirms payment, then it's removed. Stored in the stock_holdings
// store keyed by a unique positionId.

function genPositionId() {
  return `pos-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function getPosition(positionId) {
  const all = stores.stock_holdings.readMap();
  return all[positionId] || null;
}

/** All of a member's positions (open + pending) across every clan. */
function getRawUserPositions(discordId) {
  const all = stores.stock_holdings.readMap();
  return Object.values(all).filter(
    (p) => p && p.discordId === discordId && p.positionId && Number(p.shares) > 0
  );
}

/** Positions still on the books for a member in one clan (any status). */
function getOpenPositionCount(guildId, discordId) {
  return getRawUserPositions(discordId).filter((p) => p.guildId === guildId).length;
}

/** Milliseconds left before a position may be sold (0 = sellable now). */
function getPositionCooldownRemaining(position) {
  if (!position || !position.openedAt) return 0;
  const elapsed = Date.now() - new Date(position.openedAt).getTime();
  return Math.max(0, SELL_COOLDOWN_MS - elapsed);
}

/** Add live valuation + P&L figures to a position for display. */
function enrichPosition(p) {
  const shares = Number(p.shares) || 0;
  const pendingShares = Number(p.pendingShares) || 0;
  const sellableShares = Math.max(0, shares - pendingShares);
  const buyCost = Number(p.buyCost) || 0;
  const stock = getStockRecord(p.guildId);
  const currentPrice = stock ? Number(stock.currentPrice) || 0 : 0;
  const currentValue = shares * currentPrice;
  const netIfSold = computeSellPayout(shares, currentPrice).net; // payout after fee (whole position)
  const pnl = netIfSold - buyCost;
  const pnlPercent = buyCost > 0 ? (pnl / buyCost) * 100 : 0;
  return {
    positionId: p.positionId,
    guildId: p.guildId,
    discordId: p.discordId,
    ign: p.ign,
    shares,
    pendingShares,
    sellableShares,
    buyPricePerShare: Number(p.buyPricePerShare) || 0,
    buyCost,
    openedAt: p.openedAt,
    currentPrice,
    currentValue,
    netIfSold,
    pnl,
    pnlPercent,
    cooldownMs: getPositionCooldownRemaining(p),
  };
}

/** A member's positions across all clans, enriched for display. */
function getUserPositions(discordId) {
  return getRawUserPositions(discordId).map(enrichPosition);
}

/** A member's positions in a single clan, enriched for display. */
function getUserPositionsInClan(guildId, discordId) {
  return getUserPositions(discordId).filter((p) => p.guildId === guildId);
}

/** Persist a new open position. */
function createPosition({ guildId, discordId, ign, shares, buyPricePerShare, buyCost }) {
  const all = stores.stock_holdings.readMap();
  const positionId = genPositionId();
  all[positionId] = {
    positionId,
    guildId,
    discordId,
    ign: ign || null,
    shares,
    pendingShares: 0,
    buyPricePerShare: Math.round(buyPricePerShare),
    buyCost: Math.max(0, Math.round(buyCost)),
    openedAt: new Date().toISOString(),
  };
  stores.stock_holdings.writeMap(all);
  return positionId;
}

function logTransaction(entry) {
  const all = stores.stock_transactions.readMap();
  const txId = genTxId();
  all[txId] = { txId, createdAt: new Date().toISOString(), ...entry };
  stores.stock_transactions.writeMap(all);
  return txId;
}

/**
 * Reserve listed-for-sale shares for a pending buy order (optimistic —
 * prevents two concurrent buys from both passing an availability check).
 * Refund with refundSaleShares() on timeout/failure.
 */
function reserveSaleShares(guildId, shares) {
  const stock = getStockRecord(guildId);
  if (!stock) return { success: false, reason: "no_stock_record" };
  const available = Number(stock.sharesForSale) || 0;
  if (available < shares) {
    console.log(`[stocklogic] 🚫 Reserve rejected for ${guildId}: wanted ${shares}, only ${available} listed for sale`);
    return { success: false, reason: "insufficient_available", available };
  }
  stock.sharesForSale -= shares;
  saveStockRecord(guildId, stock);
  console.log(`[stocklogic] 🔒 Reserved ${shares} listed share(s) for ${guildId} (${stock.sharesForSale} still available)`);
  return { success: true };
}

function refundSaleShares(guildId, shares) {
  const stock = getStockRecord(guildId);
  if (!stock) return false;
  stock.sharesForSale = (Number(stock.sharesForSale) || 0) + shares;
  saveStockRecord(guildId, stock);
  console.log(`[stocklogic] 🔓 Refunded ${shares} reserved share(s) to ${guildId} sale pool (now ${stock.sharesForSale})`);
  return true;
}

/**
 * Finalize a confirmed buy: shares already reserved out of treasury. Creates
 * a NEW position for this buy. `paid` is the actual amount the investor sent
 * (base + 2% fee) and becomes the position's cost basis.
 */
function completeBuy({ guildId, discordId, ign, shares, pricePerShare, paid }) {
  const buyCost = Number(paid) > 0 ? Number(paid) : computeBuyCost(shares, pricePerShare).total;
  const positionId = createPosition({ guildId, discordId, ign, shares, buyPricePerShare: pricePerShare, buyCost });

  const stock = getStockRecord(guildId);
  if (stock) {
    const before = stock.currentPrice;
    const after = priceEngine.applyTradeImpact(stock, "buy", shares);
    saveStockRecord(guildId, stock);
    console.log(`[stocklogic] 💹 BUY impact: ${guildId} price ${before} → ${after}`);
  }

  const { base, tax } = computeBuyCost(shares, pricePerShare);
  const txId = logTransaction({
    guildId, discordId, ign, positionId,
    type: "buy", shares, pricePerShare, base, tax, total: buyCost, status: "confirmed",
  });
  console.log(`[stocklogic] ✅ BUY confirmed: ${discordId} (${ign}) opened position ${positionId} — ${shares} share(s) of ${guildId} @ ${pricePerShare} (paid ${buyCost}) [tx ${txId}]`);
  return positionId;
}

/**
 * Initiate the sale of `qty` shares from a position at the current market
 * price (partial or whole). Reserves those shares (pendingShares) so they
 * can't be double-sold, and creates a durable pending-sell awaiting the clan
 * owner's payment. Payout = qty × current price − 2% fee.
 */
function createPendingSellForPosition(positionId, discordId, qty) {
  const position = getPosition(positionId);
  if (!position || position.discordId !== discordId || !position.positionId) {
    return { success: false, reason: "not_found" };
  }

  const cooldown = getPositionCooldownRemaining(position);
  if (cooldown > 0) {
    return { success: false, reason: "cooldown", cooldownMs: cooldown };
  }

  const totalShares = Number(position.shares) || 0;
  const alreadyPending = Number(position.pendingShares) || 0;
  const sellable = totalShares - alreadyPending;
  const shares = Math.floor(Number(qty) || 0);
  if (shares <= 0) return { success: false, reason: "bad_qty", sellable };
  if (shares > sellable) return { success: false, reason: "too_many", sellable };

  const stock = getStockRecord(position.guildId);
  if (!stock) return { success: false, reason: "no_stock_record" };
  const pricePerShare = Number(stock.currentPrice) || 0;
  const { base, tax, net } = computeSellPayout(shares, pricePerShare);
  // Proportional cost basis of the shares being sold (for P&L display).
  const soldBuyCost = totalShares > 0 ? Math.round((Number(position.buyCost) || 0) * shares / totalShares) : 0;

  // Reserve the shares on the position so they can't be double-sold.
  const holdings = stores.stock_holdings.readMap();
  const txId = genTxId();
  if (holdings[positionId]) {
    holdings[positionId].pendingShares = alreadyPending + shares;
    stores.stock_holdings.writeMap(holdings);
  }

  const all = stores.stock_pending_sells.readMap();
  all[txId] = {
    txId,
    positionId,
    guildId: position.guildId,
    discordId,
    ign: position.ign,
    shares,
    pricePerShare,
    soldBuyCost,
    grossPayout: base,
    tax,
    payout: net,
    status: "pending_payment",
    createdAt: new Date().toISOString(),
  };
  stores.stock_pending_sells.writeMap(all);
  console.log(`[stocklogic] 📉 SELL pending: ${discordId} (${position.ign}) selling ${shares}/${totalShares} share(s) of position ${positionId} (${position.guildId}), net payout ${net} (gross ${base} − tax ${tax}) [tx ${txId}]`);
  return { success: true, txId, shares, payout: net, grossPayout: base, tax, guildId: position.guildId, soldBuyCost };
}

function getPendingSell(txId) {
  const all = stores.stock_pending_sells.readMap();
  return all[txId] || null;
}

/**
 * Clan owner has paid the investor in-game — finalize the sell: debit the
 * sold shares from the position (closing it if it hits zero) and return them
 * to the owner's holding (they can re-list). Reduces the position's cost basis
 * proportionally so remaining shares keep the right average.
 */
function markSellPaid(txId) {
  const all = stores.stock_pending_sells.readMap();
  const pending = all[txId];
  if (!pending || pending.status !== "pending_payment") {
    console.warn(`[stocklogic] ⚠️ markSellPaid: tx ${txId} not found or already confirmed`);
    return { success: false, reason: "not_found" };
  }

  const holdings = stores.stock_holdings.readMap();
  const position = pending.positionId ? holdings[pending.positionId] : null;
  const soldShares = Number(pending.shares) || 0;

  if (position) {
    const posShares = Number(position.shares) || 0;
    const posCost = Number(position.buyCost) || 0;
    const debited = Math.min(posShares, soldShares);
    const remaining = posShares - debited;
    if (remaining <= 0) {
      delete holdings[pending.positionId];
    } else {
      position.shares = remaining;
      position.buyCost = Math.round(posCost * remaining / posShares);
      position.pendingShares = Math.max(0, (Number(position.pendingShares) || 0) - debited);
    }
    stores.stock_holdings.writeMap(holdings);
  }

  // Shares return to the clan owner's holding automatically (owner holding =
  // outstanding − investor holdings, which just dropped). They are NOT
  // auto-listed for sale — the owner re-lists if they want.
  const stock = getStockRecord(pending.guildId);
  if (stock) {
    const before = stock.currentPrice;
    const after = priceEngine.applyTradeImpact(stock, "sell", soldShares);
    saveStockRecord(pending.guildId, stock);
    console.log(`[stocklogic] 💹 SELL impact: ${pending.guildId} price ${before} → ${after}`);
  }

  pending.status = "confirmed";
  stores.stock_pending_sells.writeMap(all);

  logTransaction({
    guildId: pending.guildId,
    discordId: pending.discordId,
    ign: pending.ign,
    positionId: pending.positionId,
    type: "sell",
    shares: soldShares,
    pricePerShare: pending.pricePerShare,
    total: pending.payout,
    status: "confirmed",
  });

  const remainingPositions = getOpenPositionCount(pending.guildId, pending.discordId);
  console.log(`[stocklogic] ✅ SELL paid: ${pending.discordId} (${pending.ign}) sold ${soldShares} share(s) of ${pending.guildId} for ${pending.payout} [tx ${txId}] — ${remainingPositions} position(s) left`);
  return { success: true, remainingPositions, shares: soldShares, payout: pending.payout, guildId: pending.guildId, discordId: pending.discordId };
}

/**
 * One-time migration: convert any legacy aggregate holdings (keyed by
 * guildId:discordId, with `invested`) into individual positions, and drop
 * legacy pending sells that predate position tracking. Safe to run repeatedly.
 */
function migrateLegacyHoldings() {
  const all = stores.stock_holdings.readMap();
  let migrated = 0;
  for (const key of Object.keys(all)) {
    const v = all[key];
    if (!v || v.positionId) continue; // already a position
    if (typeof v.invested === "undefined") continue; // not a legacy holding
    const shares = Number(v.shares) || 0;
    if (shares <= 0) { delete all[key]; continue; }
    const buyCost = Number(v.invested) || 0;
    // Recover the pre-fee market price from the fee-inclusive cost basis.
    const buyPricePerShare = Math.round(buyCost / (shares * (1 + TAX_RATE)));
    const positionId = genPositionId();
    all[positionId] = {
      positionId,
      guildId: v.guildId,
      discordId: v.discordId,
      ign: v.ign || null,
      shares,
      pendingShares: 0,
      buyPricePerShare,
      buyCost,
      openedAt: v.lastBuyAt || v.updatedAt || new Date().toISOString(),
    };
    delete all[key];
    migrated++;
  }
  if (migrated > 0) {
    stores.stock_holdings.writeMap(all);
    console.log(`[stocklogic] 🔀 Migrated ${migrated} legacy holding(s) into positions`);
  }

  // Move any stock records off the old `treasuryShares` field: the auto-filled
  // treasury is gone — the clan owner now holds all unsold shares and lists
  // what they choose, so start every clan's listed pool at 0.
  const clanStocks = stores.clan_stocks.readMap();
  let migratedStocks = 0;
  for (const gid of Object.keys(clanStocks)) {
    const s = clanStocks[gid];
    if (s && typeof s.treasuryShares !== "undefined" && typeof s.sharesForSale === "undefined") {
      s.sharesForSale = 0;
      delete s.treasuryShares;
      migratedStocks++;
    }
  }
  if (migratedStocks > 0) {
    stores.clan_stocks.writeMap(clanStocks);
    console.log(`[stocklogic] 🔀 Reset ${migratedStocks} clan stock(s) to owner-listed sales (sharesForSale=0)`);
  }

  // Legacy pending sells (no positionId) can't map to a position — drop them
  // so nothing is stuck; the seller can re-initiate from their portfolio.
  const pend = stores.stock_pending_sells.readMap();
  let droppedPend = 0;
  for (const k of Object.keys(pend)) {
    if (pend[k] && !pend[k].positionId && pend[k].status === "pending_payment") {
      delete pend[k];
      droppedPend++;
    }
  }
  if (droppedPend > 0) {
    stores.stock_pending_sells.writeMap(pend);
    console.log(`[stocklogic] 🔀 Dropped ${droppedPend} legacy pending sell(s)`);
  }
  return { migrated, droppedPend };
}

/**
 * Compare the first visible candle's open to the latest close, over
 * whatever window is currently charted (up to the last MAX_VISIBLE_CANDLES).
 * @param {Array<{o:number,c:number}>} candles
 * @returns {{ absolute: number, percent: number, direction: "up"|"down"|"flat" }}
 */
function computePriceChange(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { absolute: 0, percent: 0, direction: "flat" };
  }
  const first = candles[0].o;
  const last = candles[candles.length - 1].c;
  const absolute = last - first;
  const percent = first > 0 ? (absolute / first) * 100 : 0;
  const direction = absolute > 0 ? "up" : absolute < 0 ? "down" : "flat";
  return { absolute, percent, direction };
}

module.exports = {
  SHARES_PER_MEMBER,
  TAX_RATE,
  SELL_COOLDOWN_MS,
  computeBuyCost,
  computeSellPayout,
  computePriceChange,
  getClanServerId,
  getStockRecord,
  saveStockRecord,
  getOrCreateStockRecord,
  onResidentAdded,
  getInvestorHeldTotal,
  getOwnerHolding,
  getOwnerUnlisted,
  listShares,
  getPosition,
  getUserPositions,
  getUserPositionsInClan,
  getOpenPositionCount,
  getPositionCooldownRemaining,
  createPosition,
  logTransaction,
  reserveSaleShares,
  refundSaleShares,
  completeBuy,
  createPendingSellForPosition,
  getPendingSell,
  markSellPaid,
  migrateLegacyHoldings,
};

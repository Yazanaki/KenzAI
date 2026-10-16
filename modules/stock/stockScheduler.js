// modules/stock/stockScheduler.js
// Periodic candle-roll tick for every clan that has a stock record. This does
// NOT change any prices — prices only move on buys/sells. The tick simply
// rolls the chart's candle buckets forward over time at the current price so
// the graph keeps a proper time axis (flat while there's no trading).
// Modeled 1:1 on modules/roles/roleScheduler.js: an initial delay to let
// caches settle after startup, then a recurring interval.

const { stores } = require("../database/stores");
const priceEngine = require("./priceEngine");

const DEFAULT_TICK_MINUTES = 10;
const INITIAL_DELAY_MS = 60 * 1000;

let intervalTimer = null;
let initialTimer = null;
let started = false;
let running = false;

/**
 * Resolve the tick interval. Defaults to 10 minutes; override with
 * STOCK_TICK_INTERVAL_MINUTES (e.g. "1" for fast testing).
 */
function getIntervalMs() {
  const minutes = parseFloat(process.env.STOCK_TICK_INTERVAL_MINUTES);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : DEFAULT_TICK_MINUTES * 60 * 1000;
}

/** Roll every clan's chart candles forward once (no price change). Safe to call manually. */
function tickAllStocks() {
  if (running) {
    console.log("[stockScheduler] ⏭️ Previous tick still running, skipping this cycle");
    return { ok: 0, failed: 0 };
  }

  running = true;
  let ok = 0, failed = 0;
  try {
    const all = stores.clan_stocks.readMap();
    const guildIds = Object.keys(all);
    if (!guildIds.length) return { ok, failed };

    console.log(`[stockScheduler] 🔄 Ticking ${guildIds.length} clan stock(s)`);

    for (const guildId of guildIds) {
      try {
        const stock = all[guildId];
        priceEngine.tick(stock, new Date());
        ok++;
      } catch (err) {
        failed++;
        console.error(`[stockScheduler] ❌ Error ticking ${guildId}:`, err.message);
      }
    }

    stores.clan_stocks.writeMap(all);
    console.log(`[stockScheduler] 📊 Tick complete — ok:${ok} failed:${failed}`);
  } finally {
    running = false;
  }
  return { ok, failed };
}

/** Start the recurring price-tick scheduler. */
function startStockScheduler() {
  if (started) {
    console.log("[stockScheduler] ⚠️ Stock scheduler already running");
    return;
  }
  started = true;

  // One-time: migrate any legacy aggregate holdings into per-buy positions.
  try {
    require("./stocklogic").migrateLegacyHoldings();
  } catch (err) {
    console.error("[stockScheduler] ❌ Legacy holdings migration failed:", err.message);
  }

  const interval = getIntervalMs();
  console.log(
    `[stockScheduler] 🚀 Clan stock candle ticks enabled — every ${(interval / 60000).toFixed(1)}m ` +
    `(first run in ${Math.round(INITIAL_DELAY_MS / 1000)}s)`
  );

  initialTimer = setTimeout(() => {
    tickAllStocks();
    intervalTimer = setInterval(tickAllStocks, interval);
  }, INITIAL_DELAY_MS);
}

function stopStockScheduler() {
  if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
  started = false;
  console.log("[stockScheduler] ⏸️ Stock scheduler stopped");
}

module.exports = {
  startStockScheduler,
  stopStockScheduler,
  tickAllStocks,
};

// modules/discord/giveaways/scheduling/scheduler.js
// Polls for giveaways whose end time has passed and ends them. Modeled on
// modules/stock/stockScheduler.js: an initial delay to let caches settle, then
// a recurring interval with a re-entrancy guard.

const store = require("../giveawayStore");
const logic = require("../giveawaylogic");
const scheduleStore = require("./scheduleStore");
const templates = require("../templates/templates");

const DEFAULT_TICK_SECONDS = 30;
const INITIAL_DELAY_MS = 15 * 1000;

let intervalTimer = null;
let initialTimer = null;
let started = false;
let running = false;

function getIntervalMs() {
  const s = parseFloat(process.env.DISCORD_GIVEAWAY_TICK_SECONDS);
  return (Number.isFinite(s) && s > 0 ? s : DEFAULT_TICK_SECONDS) * 1000;
}

async function tick(client) {
  if (running) return;
  running = true;
  try {
    const now = Date.now();

    // Launch recurring giveaways whose next run time has arrived.
    const dueScheds = scheduleStore.dueSchedules(now);
    for (const sched of dueScheds) {
      try {
        const tpl = templates.get(sched.guildId, sched.templateName);
        if (!tpl) {
          console.warn(`[discord/giveaways] ⚠️ Schedule ${sched.scheduleId}: template "${sched.templateName}" missing — disabling`);
          sched.enabled = false;
          scheduleStore.save(sched);
          continue;
        }
        await logic.launchGiveaway(client, {
          guildId: sched.guildId,
          channelId: sched.channelId,
          hostId: sched.hostId,
          prize: tpl.prize,
          winnerCount: tpl.winnerCount || 1,
          durationMs: tpl.durationMs,
          requiredRoleId: tpl.requiredRoleId || null,
          requiredLevel: tpl.requiredLevel || 0,
          bonusEntries: tpl.bonusEntries || {},
        });
        // Advance next run, skipping any missed windows to avoid a backlog.
        let next = new Date(sched.nextRunAt).getTime();
        do {
          next += sched.intervalMs;
        } while (next <= now);
        sched.nextRunAt = new Date(next).toISOString();
        sched.lastRunAt = new Date(now).toISOString();
        scheduleStore.save(sched);
      } catch (err) {
        console.error(`[discord/giveaways] ❌ recurring ${sched.scheduleId}:`, err.message);
      }
    }

    // Activate scheduled giveaways whose start time has arrived.
    const starting = store.dueToStart(now);
    if (starting.length) {
      console.log(`[discord/giveaways] ⏱️ Starting ${starting.length} scheduled giveaway(s)`);
      for (const record of starting) {
        try {
          await logic.activateGiveaway(client, record);
        } catch (err) {
          console.error(`[discord/giveaways] ❌ starting ${record.messageId}:`, err.message);
        }
      }
    }

    // End active giveaways whose end time has passed.
    const due = store.dueGiveaways(now);
    if (due.length) {
      console.log(`[discord/giveaways] 🎉 Ending ${due.length} due giveaway(s)`);
      for (const record of due) {
        try {
          await logic.endGiveaway(client, record);
        } catch (err) {
          console.error(`[discord/giveaways] ❌ ending ${record.messageId}:`, err.message);
        }
      }
    }
  } finally {
    running = false;
  }
}

function startGiveawayScheduler(client) {
  if (started) return;
  started = true;
  const interval = getIntervalMs();
  console.log(`[discord/giveaways] 🚀 Giveaway scheduler enabled — every ${Math.round(interval / 1000)}s`);
  initialTimer = setTimeout(() => {
    tick(client);
    intervalTimer = setInterval(() => tick(client), interval);
  }, INITIAL_DELAY_MS);
}

function stopGiveawayScheduler() {
  if (initialTimer) clearTimeout(initialTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  initialTimer = intervalTimer = null;
  started = false;
}

module.exports = { startGiveawayScheduler, stopGiveawayScheduler, tick };

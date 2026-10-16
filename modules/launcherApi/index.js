// modules/launcherApi/index.js
// Hosts the Yazanaki Client API (launcher sign-in, client cosmetics, the
// in-game mod's member list) inside KenzAI, so it needs no server of its own.
// The routes in ./api are a copy of YazanakiAPI (app.js, auth/, cosmetics/,
// mod/); change them there and copy them over with its
// scripts/sync-to-kenzai.sh.
//
// Uses KenzAI's MySQL pool (same database) and DMs sign-in codes directly
// with the bot, so no internal secret is involved.
//
// .env:
//   LAUNCHER_API_PORT   port to listen on; defaults to the panel's SERVER_PORT.
//                       Leave both unset to keep the API off.
//   LAUNCHER_API_HOST   default 0.0.0.0 (all interfaces)
//   TRUST_PROXY         set (e.g. "loopback" or "1") behind a reverse proxy
//   OG_CAPE_CLOSED=1    stop granting the OG cape to new sign-ins

"use strict";

const mysqlPool = require("../database/mysqlPool");
const { sendLoginCode } = require("../launcher/loginCode");

// Loaded only when the API starts, and never fatally: if express/cors aren't
// installed yet (npm install not run after an update), the bot keeps running.
function loadApi() {
  try {
    return require("./api/app");
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") {
      console.warn(`[launcherApi] ⚠️ ${err.message.split("\n")[0]} — run npm install to enable the Yazanaki Client API`);
      return null;
    }
    throw err;
  }
}

function startLauncherApi(client) {
  const port = parseInt(process.env.LAUNCHER_API_PORT || process.env.SERVER_PORT || "", 10);
  if (!port) {
    console.warn("[launcherApi] ⚠️ LAUNCHER_API_PORT not set — Yazanaki Client API disabled");
    return null;
  }
  const db = mysqlPool.getPool();
  if (!db) {
    console.warn("[launcherApi] ⚠️ MySQL is not enabled — Yazanaki Client API disabled (it needs the members tables)");
    return null;
  }

  const api = loadApi();
  if (!api) return null;
  const { createApp, ensureTables } = api;

  const app = createApp({
    db,
    // In-process: the bot sends the DM itself.
    sendCode: ({ discordId, code, empireId }) =>
      sendLoginCode(client, { discordId, code, empireId, expiresInMinutes: 5 }),
  });

  const host = process.env.LAUNCHER_API_HOST || "0.0.0.0";
  const server = app.listen(port, host, () => {
    console.log(`[launcherApi] ✅ Yazanaki Client API on http://${host}:${port}`);
  });
  server.on("error", (err) => console.error("[launcherApi] ❌ server error:", err.message));

  ensureTables(db)
    .then(() => console.log("[launcherApi] ✅ launcher + cosmetics tables ready"))
    .catch((err) => console.error("[launcherApi] ❌ could not create tables:", err.message));

  return server;
}

module.exports = { startLauncherApi };

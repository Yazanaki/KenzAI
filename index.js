// index.js
// Handles: bot startup, command loading/deployment, event loading.
// All interaction handling lives in events/interactionCreate.js.

require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// IMPORTS
// ============================================================
const { initDatabase } = require('./modules/database/bootstrap');
const { startScheduler } = require('./modules/empire/draftscheduler');
const { startRoleScheduler } = require('./modules/roles/roleScheduler');
const { startStockScheduler } = require('./modules/stock/stockScheduler');
const { setupPointsEvents } = require('./modules/points/pointsevents');
const { startBotMonitor } = require('./modules/mcbot/botmonitor');
const { startCosmeticsServer } = require('./modules/cosmetics/cosmeticsServer');
const { initDiscord } = require('./modules/discord/init');

// ============================================================
// CLIENT SETUP
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
  ],
});

client.commands = new Collection();

// ============================================================
// CONFIG FLAGS
// ============================================================
const AUTO_CLEAR_COMMANDS = false;
const FORCE_DEPLOY = false;
const DEPLOYMENT_MODE = 'all-guilds';

// ============================================================
// EVENT LOADER
// Reads every file in ./events/ and registers it with the client.
// This is what makes events/interactionCreate.js actually run.
// ============================================================
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  try {
    const event = require(filePath);
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
    console.log(`✅ Registered event: ${event.name} (from events/${file})`);
  } catch (err) {
    console.warn(`⚠️ Failed to load event events/${file}:`, err.message);
  }
}

// ============================================================
// COMMAND DEPLOYMENT
// ============================================================

// Recursively collect every .js file under `dir`, returned as paths relative to
// `dir`. This lets modules organise commands into nested subfolders (e.g. the
// discord module's moderation/, levels/, giveaways/ trees) instead of being
// limited to files directly in the module root. Flat modules are unaffected.
// Files in the current directory are returned BEFORE files in subdirectories
// (shallow-first). Combined with the first-wins de-dupe in deployCommands, this
// preserves legacy behaviour where only a module's top-level files were scanned
// (e.g. modules/mcbot/patreon.js wins over an older nested duplicate).
function walkJsFiles(dir) {
  const files = [];
  const subdirs = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) subdirs.push(entry.name);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(entry.name);
  }
  const out = [...files];
  for (const sub of subdirs) {
    for (const f of walkJsFiles(path.join(dir, sub))) out.push(path.join(sub, f));
  }
  return out;
}

async function deployCommands(force = false, targetGuildId = null) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔄 LOADING COMMANDS...');

  const commands = [];
  const commandFolders = fs.readdirSync('./modules');

  for (const folder of commandFolders) {
    const folderPath = path.join('./modules', folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    const commandFiles = walkJsFiles(folderPath);

    for (const file of commandFiles) {
      const filePath = path.join(folderPath, file);
      try {
        delete require.cache[require.resolve(`./${filePath}`)];
        const command = require(`./${filePath}`);
        if ('data' in command && 'execute' in command) {
          // First-wins de-dupe: a shallower file already claimed this name.
          if (client.commands.has(command.data.name)) {
            console.warn(`⚠️ Skipping duplicate command /${command.data.name} from ${folder}/${file} (already loaded)`);
            continue;
          }
          client.commands.set(command.data.name, command);
          commands.push(command.data.toJSON());
          console.log(`✅ Loaded: /${command.data.name} (from ${folder}/${file})`);
        }
      } catch (err) {
        console.warn(`⚠️ Failed to load ${folder}/${file}:`, err.message);
      }
    }
  }

  if (commands.length === 0) {
    console.error('❌ No commands loaded!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return;
  }

  const commandsHash = crypto.createHash('md5').update(JSON.stringify(commands)).digest('hex');
  const hashFile = path.join(__dirname, '.commands-hash');
  let lastHash = '';
  if (fs.existsSync(hashFile)) lastHash = fs.readFileSync(hashFile, 'utf8').trim();

  if (!force && !FORCE_DEPLOY && commandsHash === lastHash) {
    console.log('✅ Commands unchanged - skipping deployment');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return;
  }

  if (FORCE_DEPLOY && !force) console.log('⚡ FORCE_DEPLOY enabled - deploying regardless of changes\n');

  try {
    const rest = new REST().setToken(process.env.TOKEN);
    console.log(`\n🔄 Deploying ${commands.length} commands in ${DEPLOYMENT_MODE.toUpperCase()} mode...`);

    if (DEPLOYMENT_MODE === 'all-guilds') {
      console.log('📡 Fetching latest guild list from Discord...');
      const fetchedGuilds = await client.guilds.fetch();
      console.log(`📍 Target: ${targetGuildId ? 1 : fetchedGuilds.size} guild(s)\n`);

      if (fetchedGuilds.size === 0) {
        console.error('❌ Bot is not in any guilds!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const [guildId, partialGuild] of fetchedGuilds) {
        if (targetGuildId && guildId !== targetGuildId) continue;
        try {
          const guild = await client.guilds.fetch(guildId);
          await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: commands });
          console.log(`   ✅ ${guild.name} (${guildId})`);
          successCount++;
        } catch (error) {
          console.error(`   ❌ ${partialGuild.name || guildId}: ${error.message}`);
          failCount++;
        }
      }

      console.log(`\n📊 Deployment Summary:`);
      console.log(`   ✅ Success: ${successCount}`);
      if (failCount > 0) console.log(`   ❌ Failed: ${failCount}`);

    } else {
      console.log(`🌍 Target: All guilds (global)\n⏰ Propagation time: Up to 1 hour`);
      const data = await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log(`✅ Deployed ${data.length} commands globally!`);
    }

    fs.writeFileSync(hashFile, commandsHash);
    console.log(`\n📋 Registered ${commands.length} commands:`);
    commands.forEach(cmd => console.log(`   - /${cmd.name}`));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Failed to deploy commands:', error.message);
  }
}

// ============================================================
// CLEAR DUPLICATE COMMANDS
// ============================================================
async function clearDuplicateCommands() {
  console.log('🧹 Clearing duplicate commands...\n');
  const rest = new REST().setToken(process.env.TOKEN);
  try {
    console.log('🌍 Clearing global commands...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
    console.log('✅ Global commands cleared\n');

    if (DEPLOYMENT_MODE === 'all-guilds') {
      console.log('📡 Fetching all guilds from Discord...');
      const fetchedGuilds = await client.guilds.fetch();
      console.log(`📍 Clearing commands from ${fetchedGuilds.size} guild(s)...\n`);
      for (const [guildId, partialGuild] of fetchedGuilds) {
        try {
          const guild = await client.guilds.fetch(guildId);
          await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: [] });
          console.log(`   ✅ Cleared: ${guild.name}`);
        } catch (error) {
          console.error(`   ❌ Failed: ${partialGuild.name || guildId} - ${error.message}`);
        }
      }
      console.log('\n✅ All guild commands cleared!\n');
    }
  } catch (error) {
    console.error('❌ Error clearing commands:', error);
  }
}

// ============================================================
// READY EVENT
// ============================================================
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  console.log('\n📡 Scanning all guilds bot is in...');
  try {
    const fetchedGuilds = await client.guilds.fetch();
    console.log(`✅ Found ${fetchedGuilds.size} guild(s):\n`);
    for (const [id] of fetchedGuilds) {
      const fullGuild = await client.guilds.fetch(id);
      console.log(`   - ${fullGuild.name} (${id})`);
    }
    console.log('');
  } catch (error) {
    console.error('❌ Failed to fetch guilds:', error.message);
  }

  console.log('⏳ Waiting 3 seconds for cache to stabilize...\n');
  await new Promise(resolve => setTimeout(resolve, 3000));

  if (AUTO_CLEAR_COMMANDS) {
    console.log('⚠️⚠️⚠️ AUTO-CLEAR MODE ENABLED ⚠️⚠️⚠️');
    await clearDuplicateCommands();
    console.log('\n✅ COMMANDS CLEARED!');
    console.log('⚠️ Set AUTO_CLEAR_COMMANDS = false and restart to deploy commands\n');
  } else {
    await deployCommands();
  }

  await initDatabase();

  console.log("🎖️ Ensuring squadrons exist for all High Generals...");
  const squadronLogic = require("./modules/yazanaki/squadronlogic");
  squadronLogic
    .ensureHighGeneralTrees(client)
    .then(() => {
      // Clean up recruit placements: drops phantoms (people invited but never
      // accepted, or who left / were promoted past Recruit) and slots in any
      // pending recruits that now have a soldier.
      try {
        const n = squadronLogic.reconcilePending();
        if (n) console.log(`🎖️ Reconciled ${n} recruit placement(s)`);
      } catch (e) {
        console.warn("⚠️ Squadron reconcile failed:", e.message);
      }
    })
    .catch((err) => console.warn("⚠️ Squadron backfill failed:", err.message));

  console.log("🎖️ Starting draft system...");
  startScheduler(client);

  console.log("🔄 Starting daily clan role refresh...");
  startRoleScheduler(client);

  console.log("📈 Starting clan stock candle scheduler...");
  startStockScheduler();

  setupPointsEvents(client);

  console.log("🛒 Starting internal cosmetics endpoint (for the launcher via the API)...");
  startCosmeticsServer();

  console.log("🤖 Starting bot offline monitor...");
  startBotMonitor(client);

  console.log("💬 Starting all-in-one Discord module (moderation, leveling, giveaways, invites, stats)...");
  try {
    initDiscord(client);
  } catch (err) {
    console.error("❌ Failed to init Discord module:", err.message);
  }
});

// ============================================================
// NEW GUILD — AUTO DEPLOY COMMANDS ON JOIN
// ============================================================
client.on('guildCreate', async (guild) => {
  console.log(`➕ Joined new guild: ${guild.name} (${guild.id})`);
  try {
    await deployCommands(true, guild.id);
    console.log(`✅ Commands deployed to new guild: ${guild.name} (${guild.id})`);
  } catch (error) {
    console.error(`❌ Failed to deploy commands for new guild ${guild.name} (${guild.id}):`, error);
  }
});

// ============================================================
// ERROR HANDLING
// ============================================================
client.on('error', error => {
  console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('❌ Unhandled promise rejection:', error);
});

// ============================================================
// LOGIN
// ============================================================
console.log('🔐 Attempting to login...');
console.log('📁 Current directory:', __dirname);
console.log('🔑 Token loaded:', process.env.TOKEN ? `Yes (${process.env.TOKEN.length} chars)` : 'NO - TOKEN NOT FOUND');
console.log('🆔 Client ID loaded:', process.env.CLIENT_ID ? 'Yes' : 'No');

if (!process.env.TOKEN) {
  console.error('❌ TOKEN not found in environment variables!');
  console.error('Make sure .env file exists in:', __dirname);
  process.exit(1);
}

if (!process.env.CLIENT_ID) {
  console.error('❌ CLIENT_ID not found in environment variables!');
  console.error('Add CLIENT_ID to your .env file');
  process.exit(1);
}

client.login(process.env.TOKEN).catch(error => {
  console.error('❌ Failed to login:', error);
  process.exit(1);
});
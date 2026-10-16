// modules/discord/init.js
// Wires every gateway listener the Discord module needs and starts its
// schedulers. Called once from the `ready` block in index.js (like
// setupPointsEvents). Adding extra client.on listeners alongside the existing
// events/* handlers is safe — Discord.js supports many listeners per event.

const automod = require("./moderation/automod/rules");
const levelXp = require("./levels/messages/xp");
const voiceXp = require("./levels/voicecall/voiceXp");
const inviteEvents = require("./invites/inviteEvents");
const inviteCache = require("./invites/inviteCache");
const giveawayScheduler = require("./giveaways/scheduling/scheduler");

const statMessages = require("./statistics/messages/collector");
const statJoins = require("./statistics/joins/collector");
const statLeaves = require("./statistics/leaves/collector");
const statVoice = require("./statistics/voicecall/collector");
const statsStore = require("./statistics/statsStore");
const boostEvents = require("./boosters/boostEvents");

function initDiscord(client) {
  // --- messages ---
  client.on("messageCreate", (message) => {
    automod.handleMessage(message);
    levelXp.handleMessage(message);
    statMessages.handleMessage(message);
    boostEvents.handleBoostMessage(message);
  });
  client.on("messageDelete", (message) => statMessages.handleDelete(message));
  client.on("messageUpdate", (oldMsg, newMsg) => statMessages.handleEdit(oldMsg, newMsg));

  // --- voice ---
  client.on("voiceStateUpdate", (oldState, newState) => {
    voiceXp.handleVoiceState(oldState, newState);
    statVoice.handleVoiceState(oldState, newState);
  });

  // --- membership ---
  client.on("guildMemberAdd", (member) => {
    automod.handleJoin(member);
    inviteEvents.handleGuildMemberAdd(member);
    statJoins.handleJoin(member);
  });
  client.on("guildMemberRemove", (member) => {
    inviteEvents.handleGuildMemberRemove(member);
    statLeaves.handleLeave(member);
  });

  // --- boosters (custom-role lifecycle) ---
  client.on("guildMemberUpdate", (oldM, newM) => boostEvents.handleGuildMemberUpdate(oldM, newM));

  // --- invites cache upkeep ---
  client.on("inviteCreate", (invite) => inviteEvents.handleInviteCreate(invite));
  client.on("inviteDelete", (invite) => inviteEvents.handleInviteDelete(invite));

  // --- schedulers / background ---
  giveawayScheduler.startGiveawayScheduler(client);
  voiceXp.startVoiceScheduler(client);
  statsStore.startFlush(60000);

  // Prime the per-guild invite snapshot so join attribution works immediately.
  inviteCache.primeAll(client).catch((err) => console.error("[discord] ❌ invite cache prime:", err.message));

  console.log("[discord] ✅ Module initialised (moderation, automod, leveling, giveaways, invites, stats)");
}

module.exports = { initDiscord };

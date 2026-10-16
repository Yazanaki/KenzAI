// modules/discord/invites/inviteStore.js
// Per-user invite stats over the `discord_invites` store, keyed by
// "<guildId>:<userId>". Each record holds BOTH the user's own invite counts
// and the attribution of how *they* joined (who invited them), so a leave can
// be credited back to the right inviter.
//
//   counts:      regular, fake, left, bonus   (net = regular + bonus - fake - left)
//   attribution: invitedBy, joinFake, code

const { stores } = require("../../database/stores");
const { memberKey } = require("../common/util");

const store = () => stores.discord_invites;

function all() {
  return store().readMap();
}

function base(guildId, userId) {
  return { guildId, userId, regular: 0, fake: 0, left: 0, bonus: 0, invitedBy: null, joinFake: false, code: null };
}

function get(guildId, userId) {
  const rec = all()[memberKey(guildId, userId)];
  return rec ? { ...base(guildId, userId), ...rec } : base(guildId, userId);
}

function mutate(guildId, userId, fn) {
  const map = all();
  const key = memberKey(guildId, userId);
  const rec = map[key] ? { ...base(guildId, userId), ...map[key] } : base(guildId, userId);
  fn(rec);
  map[key] = rec;
  store().writeMap(map);
  return rec;
}

const net = (r) => (r.regular || 0) + (r.bonus || 0) - (r.fake || 0) - (r.left || 0);

const addRegular = (g, u, n = 1) => mutate(g, u, (r) => (r.regular += n));
const addFake = (g, u, n = 1) => mutate(g, u, (r) => (r.fake += n));
const addLeft = (g, u, n = 1) => mutate(g, u, (r) => (r.left += n));
const addBonus = (g, u, n) => mutate(g, u, (r) => (r.bonus += n));

/** Record how a member joined (attribution stored on the invitee's record). */
function setInvitee(guildId, userId, { invitedBy, joinFake, code }) {
  return mutate(guildId, userId, (r) => {
    r.invitedBy = invitedBy;
    r.joinFake = !!joinFake;
    r.code = code || null;
  });
}

function forGuild(guildId) {
  return Object.values(all()).filter((r) => r && r.guildId === guildId);
}

/** Leaderboard sorted by net invites (descending), positives only. */
function leaderboard(guildId) {
  return forGuild(guildId)
    .filter((r) => net(r) > 0 || r.regular > 0)
    .sort((a, b) => net(b) - net(a));
}

module.exports = {
  get,
  mutate,
  net,
  addRegular,
  addFake,
  addLeft,
  addBonus,
  setInvitee,
  forGuild,
  leaderboard,
};

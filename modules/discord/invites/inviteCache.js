// modules/discord/invites/inviteCache.js
// In-memory snapshot of each guild's invite uses so that on guildMemberAdd we
// can diff current uses against the snapshot to find which invite was used.
// Purely runtime state (rebuilt on startup); never persisted.

const cache = new Map(); // guildId -> Map(code -> uses)

function guildMap(guildId) {
  if (!cache.has(guildId)) cache.set(guildId, new Map());
  return cache.get(guildId);
}

async function primeGuild(guild) {
  try {
    const invites = await guild.invites.fetch();
    const m = guildMap(guild.id);
    m.clear();
    for (const inv of invites.values()) m.set(inv.code, inv.uses || 0);
    // Vanity URL (if any) counts under a reserved key.
    if (guild.vanityURLCode) {
      const v = await guild.fetchVanityData().catch(() => null);
      if (v) m.set(`__vanity_${guild.vanityURLCode}`, v.uses || 0);
    }
  } catch {
    /* missing Manage Guild / invites intent — feature just won't attribute here */
  }
}

async function primeAll(client) {
  for (const guild of client.guilds.cache.values()) await primeGuild(guild);
}

function setCode(guildId, code, uses) {
  guildMap(guildId).set(code, uses);
}

function deleteCode(guildId, code) {
  guildMap(guildId).delete(code);
}

/**
 * Fetch current invites, find the one whose uses increased vs the snapshot,
 * refresh the snapshot, and return { inviterId, code } or null.
 */
async function resolveUsedInvite(guild) {
  let invites;
  try {
    invites = await guild.invites.fetch();
  } catch {
    return null;
  }
  const snap = guildMap(guild.id);
  let used = null;
  for (const inv of invites.values()) {
    const prev = snap.get(inv.code) || 0;
    const cur = inv.uses || 0;
    if (!used && cur > prev) used = inv;
    snap.set(inv.code, cur);
  }
  // Remove codes that no longer exist (used-up single-use invites).
  for (const code of [...snap.keys()]) {
    if (!code.startsWith("__vanity_") && !invites.has(code)) snap.delete(code);
  }
  if (!used) return null;
  return { inviterId: used.inviter?.id || null, code: used.code };
}

module.exports = { primeGuild, primeAll, setCode, deleteCode, resolveUsedInvite };

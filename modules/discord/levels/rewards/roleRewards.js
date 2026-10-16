// modules/discord/levels/rewards/roleRewards.js
// Grant (and optionally un-stack) level-reward roles when a member reaches a
// new level. Config: leveling.roleRewards = { "<level>": "<roleId>" }.

/**
 * Reconcile a member's reward roles for their current level.
 * @returns {Promise<string[]>} role ids newly granted
 */
async function applyRewards(member, level, leveling) {
  const rewards = leveling.roleRewards || {};
  const entries = Object.entries(rewards)
    .map(([lvl, roleId]) => ({ lvl: Number(lvl), roleId }))
    .filter((e) => e.roleId && Number.isFinite(e.lvl))
    .sort((a, b) => a.lvl - b.lvl);
  if (!entries.length) return [];

  const earned = entries.filter((e) => e.lvl <= level);
  if (!earned.length) return [];

  const granted = [];
  const me = member.guild.members.me;
  const canManage = me?.permissions?.has("ManageRoles");
  if (!canManage) return [];

  if (leveling.stackRewards === false) {
    // Keep only the single highest earned reward role; strip the rest.
    const keep = earned[earned.length - 1].roleId;
    for (const e of earned) {
      const role = member.guild.roles.cache.get(e.roleId);
      if (!role || role.position >= me.roles.highest.position) continue;
      if (e.roleId === keep) {
        if (!member.roles.cache.has(e.roleId)) {
          await member.roles.add(e.roleId, "Level reward").catch(() => {});
          granted.push(e.roleId);
        }
      } else if (member.roles.cache.has(e.roleId)) {
        await member.roles.remove(e.roleId, "Level reward (un-stack)").catch(() => {});
      }
    }
    return granted;
  }

  // Stacking: ensure every earned role is present.
  for (const e of earned) {
    const role = member.guild.roles.cache.get(e.roleId);
    if (!role || role.position >= me.roles.highest.position) continue;
    if (!member.roles.cache.has(e.roleId)) {
      await member.roles.add(e.roleId, "Level reward").catch(() => {});
      granted.push(e.roleId);
    }
  }
  return granted;
}

module.exports = { applyRewards };

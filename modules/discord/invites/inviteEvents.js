// modules/discord/invites/inviteEvents.js
// Invite attribution on join, leave crediting, invite-cache upkeep, milestone
// role rewards, and the join log. Driven by settings.invites (config-per-guild).

const inviteStore = require("./inviteStore");
const cache = require("./inviteCache");
const { getGuildSettings } = require("../settings/settingsStore");
const { makeEmbed } = require("../common/embeds");

function isFakeAccount(user, fakeDays) {
  if (!fakeDays) return false;
  const ageMs = Date.now() - user.createdTimestamp;
  return ageMs < fakeDays * 86400 * 1000;
}

async function applyRewards(guild, inviterId) {
  const inv = getGuildSettings(guild.id).invites;
  const rewards = inv.rewards || {};
  const net = inviteStore.net(inviteStore.get(guild.id, inviterId));
  const earned = Object.entries(rewards).filter(([threshold]) => Number(threshold) <= net);
  if (!earned.length) return;
  const me = guild.members.me;
  if (!me?.permissions?.has("ManageRoles")) return;
  const member = guild.members.cache.get(inviterId) || (await guild.members.fetch(inviterId).catch(() => null));
  if (!member) return;
  for (const [, roleId] of earned) {
    const role = guild.roles.cache.get(roleId);
    if (role && role.position < me.roles.highest.position && !member.roles.cache.has(roleId)) {
      await member.roles.add(roleId, "Invite milestone reward").catch(() => {});
    }
  }
}

async function postJoinLog(guild, member, inviterId, fake) {
  const inv = getGuildSettings(guild.id).invites;
  if (!inv.joinLogChannelId) return;
  const ch = guild.channels.cache.get(inv.joinLogChannelId);
  if (!ch?.isTextBased()) return;

  let desc;
  if (inviterId) {
    const net = inviteStore.net(inviteStore.get(guild.id, inviterId));
    desc = `📥 <@${member.id}> joined — invited by <@${inviterId}> (now **${net}** invites)${fake ? " ⚠️ *counted as fake (new account)*" : ""}`;
  } else {
    desc = `📥 <@${member.id}> joined — inviter could not be determined.`;
  }
  await ch.send({ embeds: [makeEmbed({ color: fake ? "warn" : "success", description: desc })] }).catch(() => {});
}

async function handleGuildMemberAdd(member) {
  try {
    const guild = member.guild;
    const inv = getGuildSettings(guild.id).invites;
    if (!inv.enabled) return;
    if (member.user.bot) {
      await cache.primeGuild(guild); // keep snapshot fresh; bots don't count
      return;
    }

    const used = await cache.resolveUsedInvite(guild);
    const inviterId = used?.inviterId || null;
    const fake = isFakeAccount(member.user, inv.fakeAccountAgeDays);

    if (inviterId && inviterId !== member.id) {
      inviteStore.setInvitee(guild.id, member.id, { invitedBy: inviterId, joinFake: fake, code: used.code });
      if (fake) inviteStore.addFake(guild.id, inviterId);
      else {
        inviteStore.addRegular(guild.id, inviterId);
        await applyRewards(guild, inviterId);
      }
    }
    await postJoinLog(guild, member, inviterId, fake);
  } catch (err) {
    console.error("[discord/invites] ❌ member add:", err.message);
  }
}

async function handleGuildMemberRemove(member) {
  try {
    const guild = member.guild;
    const inv = getGuildSettings(guild.id).invites;
    if (!inv.enabled) return;
    const rec = inviteStore.get(guild.id, member.id);
    if (rec.invitedBy && !rec.joinFake) {
      inviteStore.addLeft(guild.id, rec.invitedBy);
    }
  } catch (err) {
    console.error("[discord/invites] ❌ member remove:", err.message);
  }
}

function handleInviteCreate(invite) {
  if (invite.guild) cache.setCode(invite.guild.id, invite.code, invite.uses || 0);
}

function handleInviteDelete(invite) {
  if (invite.guild) cache.deleteCode(invite.guild.id, invite.code);
}

module.exports = {
  handleGuildMemberAdd,
  handleGuildMemberRemove,
  handleInviteCreate,
  handleInviteDelete,
};

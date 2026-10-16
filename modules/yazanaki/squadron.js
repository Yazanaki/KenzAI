// modules/yazanaki/squadron.js
// /squadron — military chain-of-command trees for the Yazanaki Empire.
//   view   [member]         personal "who is my general" chain image (public)
//   tree   [high_general]   full squadron org-chart image (public)
//   list                    summary of all trees (public)
//   add    <member> [parent] [name]   place a member (tier inferred from rank) (gated)
//   remove <member>         detach a member from their tree (gated)
//
// Ranks come live from Discord roles; the officer skeleton is stored in the
// military_squadrons store; recruits are auto-sorted by invite (military_invites).

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const L = require("./squadronlogic");
const { renderTree } = require("./squadrontree");
const { readMembers } = require("../database/membersPersistence");

const GUILD_ID = L.YAZANAKI_EMPIRE_GUILD_ID;
const ATTACHMENT = "squadron.png";
const BLACK = 0x000000;

// ---- shared helpers --------------------------------------------------------

async function fetchEmpireGuild(client) {
  return client.guilds.fetch(GUILD_ID).catch(() => null);
}

/** Map each tier to the hex color of its Discord rank role (null if default/black). */
function colorByTierFor(guild, rankRoleData) {
  const byName = rankRoleData.idByName;
  const tierRank = {
    high_general: "high general",
    general: "general",
    captain: "captain",
    imperial_army: "imperial army",
    recruit: "recruit",
  };
  const out = {};
  for (const [tier, rank] of Object.entries(tierRank)) {
    const roleId = byName[rank];
    const role = roleId && guild.roles.cache.get(roleId);
    const hex = role && role.hexColor;
    out[tier] = hex && hex !== "#000000" ? hex : null;
  }
  return out;
}

/**
 * Card name = the member's linked Minecraft username (from members.json), with
 * their Discord display name as a fallback for anyone without a linked account.
 */
function cardNameFor(id, guildMembers, memberData) {
  const rec = memberData[id];
  if (rec && rec.minecraftUser) return rec.minecraftUser;
  const gm = guildMembers.get(id);
  return gm ? gm.displayName : `Unknown (${id})`;
}

/**
 * info(id) => { name, avatarURL, present }. Name is the Minecraft username;
 * the card image is the member's Discord profile picture.
 */
function infoFrom(guildMembers, memberData) {
  return (id) => {
    const gm = guildMembers.get(id);
    return {
      name: cardNameFor(id, guildMembers, memberData),
      avatarURL: gm ? gm.displayAvatarURL({ extension: "png", size: 64, forceStatic: true }) : null,
      present: !!gm,
    };
  };
}

function tierLabelOf(tier) {
  return L.TIER_LABEL[tier] || tier;
}

/**
 * A recruit is only drawn if they're a REAL current member: present in the
 * Yazanaki guild AND an accepted member whose rank is Recruit. This filters out
 * phantoms — people invited but never accepted, or who have since left.
 */
function realRecruitPredicate(guildMembers, memberData) {
  return (id) => {
    if (!guildMembers.has(id)) return false;
    return String(memberData[id]?.YazanakiRank || "").trim().toLowerCase() === "recruit";
  };
}

/** Count nodes per tier in a built render model (matches what's drawn). */
function countTiers(model) {
  const counts = { general: 0, captain: 0, imperial_army: 0, recruit: 0 };
  (function walk(n) {
    if (counts[n.tier] != null) counts[n.tier] += 1;
    for (const c of n.children) walk(c);
  })(model);
  return counts;
}

/** Resolve the caller's Empire-guild member (for role/permission checks). */
async function callerEmpireMember(guild, userId) {
  return guild.members.fetch(userId).catch(() => null);
}

const ADD_ERRORS = {
  already_in_tree: "That member is already placed in a tree. Remove them first with `/squadron remove`.",
  parent_not_found: "The parent you specified isn't part of any tree yet.",
  bad_parent_tier: "That parent is the wrong rank for this placement.",
  capacity_full: "That leader is already at full capacity.",
  target_not_soldier: "The parent must be an **Imperial Army** soldier already placed in a tree.",
  bad_tier: "That rank can't be placed here.",
};

// ---- command ---------------------------------------------------------------

module.exports = {
  data: new SlashCommandBuilder()
    .setName("squadron")
    .setDescription("View and manage the Yazanaki military chain of command")
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("See who your general/captain is (your chain of command)")
        .addUserOption((o) => o.setName("member").setDescription("Whose chain to show (defaults to you)"))
    )
    .addSubcommand((s) =>
      s
        .setName("tree")
        .setDescription("Show a member's full squadron tree, highlighting them")
        .addUserOption((o) =>
          o.setName("member").setDescription("Anyone in a squadron — shows their tree and highlights them. Defaults to you.")
        )
    )
    .addSubcommand((s) => s.setName("list").setDescription("List all squadrons and their sizes"))
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Place a member in the chain of command (rank inferred from their role)")
        .addUserOption((o) => o.setName("member").setDescription("The member to place").setRequired(true))
        .addUserOption((o) =>
          o.setName("parent").setDescription("Their leader (High General→General→Captain→Soldier). Optional for a General.")
        )
        .addStringOption((o) => o.setName("name").setDescription("Optional squadron name (when creating a High General's tree)"))
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a member from their squadron")
        .addUserOption((o) => o.setName("member").setDescription("The member to remove").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("rename")
        .setDescription("Set a squadron's name")
        .addUserOption((o) =>
          o.setName("high_general").setDescription("The squadron's High General (or any member of it)").setRequired(true)
        )
        .addStringOption((o) => o.setName("name").setDescription("The new squadron name").setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;

    const guild = await fetchEmpireGuild(client);
    if (!guild) {
      return interaction.reply({ content: "❌ Could not reach the Yazanaki Empire server.", ephemeral: true });
    }

    const rankRoleData = L.getRankRoleData();
    const colorByTier = colorByTierFor(guild, rankRoleData);

    try {
      if (sub === "view") return await handleView(interaction, guild, colorByTier);
      if (sub === "tree") return await handleTree(interaction, guild, colorByTier);
      if (sub === "list") return await handleList(interaction, guild);
      if (sub === "add") return await handleAdd(interaction, guild, rankRoleData);
      if (sub === "remove") return await handleRemove(interaction, guild);
      if (sub === "rename") return await handleRename(interaction, guild);
    } catch (err) {
      console.error("[/squadron] ❌", err);
      const msg = "❌ Something went wrong while handling that command.";
      if (interaction.deferred || interaction.replied) return interaction.editReply({ content: msg });
      return interaction.reply({ content: msg, ephemeral: true });
    }
  },
};

// ---- view ------------------------------------------------------------------

async function handleView(interaction, guild, colorByTier) {
  await interaction.deferReply();
  const target = interaction.options.getUser("member") || interaction.user;

  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const memberData = readMembers();

  // Self-heal: a High General who somehow has no tree yet gets one on the spot.
  const targetMember = members.get(target.id);
  if (targetMember && !L.findMemberTree(target.id)) L.ensureTreeForMember(targetMember);

  const built = L.buildChainModel(target.id, {
    info: infoFrom(members, memberData),
    colorByTier,
    includeRecruit: realRecruitPredicate(members, memberData),
  });

  if (!built) {
    return interaction.editReply({
      content: `**${target.username}** isn't placed in a squadron yet. An officer can add them with \`/squadron add\`.`,
    });
  }

  const hg = members.get(built.tree.highGeneralId);
  const buffer = await renderTree(built.model, {
    title: "Your Chain of Command",
    subtitle: `${cardNameFor(target.id, members, memberData)} • ${built.tree.name || (hg ? `${hg.displayName}'s Command` : "Squadron")}`,
    highlightId: built.selfId,
  });

  const file = new AttachmentBuilder(buffer, { name: ATTACHMENT });
  const embed = new EmbedBuilder()
    .setTitle("🎖️ Chain of Command")
    .setColor(BLACK)
    .setImage(`attachment://${ATTACHMENT}`)
    .setFooter({ text: "Yazanaki Empire • Military" });

  return interaction.editReply({ embeds: [embed], files: [file] });
}

// ---- tree ------------------------------------------------------------------

async function handleTree(interaction, guild, colorByTier) {
  await interaction.deferReply();
  const target = interaction.options.getUser("member") || interaction.user;

  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const memberData = readMembers();

  // Find the squadron this member belongs to — whether they're the High General,
  // an officer node, or a placed recruit (recruits live in the invites store,
  // not in the tree's nodes).
  let squadron = L.findMemberTree(target.id);
  if (!squadron) {
    const rec = L.readInvites()[target.id];
    if (rec && rec.treeId) squadron = L.readSquadrons()[rec.treeId] || null;
  }
  if (!squadron) {
    // Self-heal: a High General with no tree yet gets one on the spot.
    const targetMember = members.get(target.id);
    if (targetMember) squadron = L.ensureTreeForMember(targetMember);
  }
  if (!squadron) {
    return interaction.editReply({
      content: `**${target.username}** isn't in a squadron yet. An officer can place them with \`/squadron add\`.`,
    });
  }

  const model = L.buildTreeModel(squadron, L.readInvites(), {
    info: infoFrom(members, memberData),
    colorByTier,
    includeRecruit: realRecruitPredicate(members, memberData),
  });

  const hg = members.get(squadron.highGeneralId);
  const treeName = squadron.name || (hg ? `${hg.displayName}'s Command` : "Squadron");
  const counts = countTiers(model);

  const buffer = await renderTree(model, {
    title: treeName,
    subtitle: `${counts.general} Generals · ${counts.captain} Captains · ${counts.imperial_army} Soldiers · ${counts.recruit} Recruits`,
    highlightId: target.id,
  });

  const file = new AttachmentBuilder(buffer, { name: ATTACHMENT });
  const embed = new EmbedBuilder()
    .setTitle(treeName)
    .setColor(BLACK)
    .setDescription(`Lead by: <@${squadron.highGeneralId}>`)
    .setImage(`attachment://${ATTACHMENT}`)
    .setFooter({ text: "Yazanaki Empire • Military" });

  return interaction.editReply({ embeds: [embed], files: [file] });
}

// ---- list ------------------------------------------------------------------

async function handleList(interaction, guild) {
  await interaction.deferReply();
  const rows = L.listTrees();

  const embed = new EmbedBuilder().setTitle("⚔️ Yazanaki Squadrons").setColor(BLACK);

  if (!rows.length) {
    embed.setDescription("No squadrons yet. An officer can create one with `/squadron add` (add a High General).");
    return interaction.editReply({ embeds: [embed] });
  }

  for (const { squadron, counts, recruits } of rows) {
    const total = counts.general + counts.captain + counts.imperial_army + recruits + 1;
    embed.addFields({
      name: squadron.name || `High General's Command`,
      value:
        `👑 Leader: <@${squadron.highGeneralId}>\n` +
        `${counts.general} Generals · ${counts.captain} Captains · ${counts.imperial_army} Soldiers · ${recruits} Recruits\n` +
        `**${total}** total`,
      inline: false,
    });
  }
  embed.setFooter({ text: `${rows.length} squadron(s)` });
  return interaction.editReply({ embeds: [embed] });
}

// ---- add -------------------------------------------------------------------

async function handleAdd(interaction, guild, rankRoleData) {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser("member", true);
  const parentUser = interaction.options.getUser("parent");
  const name = interaction.options.getString("name");

  const caller = await callerEmpireMember(guild, interaction.user.id);
  if (!caller) {
    return interaction.editReply({ content: "❌ You must be a member of the Yazanaki Empire to manage squadrons." });
  }

  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    return interaction.editReply({ content: `❌ **${targetUser.username}** isn't in the Yazanaki Empire server.` });
  }

  const tier = L.getMemberTier(targetMember, rankRoleData.rankRoles);
  if (!tier) {
    return interaction.editReply({
      content: `❌ **${targetUser.username}** has no military rank role (Recruit / Imperial Army / Captain / General / High General). Give them a rank first.`,
    });
  }

  const { royaltyRoleId } = L.getGovRoleIds();
  const isRoyalty = caller.roles.cache.has(royaltyRoleId);

  // --- High General → create a tree ---
  if (tier === L.TIER.HIGH_GENERAL) {
    const perm = L.canManage(caller, null);
    if (!perm.allowed) return interaction.editReply({ content: denyMessage(perm) });
    if (!isRoyalty && targetUser.id !== interaction.user.id) {
      return interaction.editReply({ content: "❌ As a High General you can only create **your own** tree." });
    }
    const res = L.createTree(targetUser.id, name, interaction.user.id);
    if (!res.ok) {
      return interaction.editReply({
        content: res.error === "already_in_tree" ? `❌ <@${targetUser.id}> is already in a squadron.` : "❌ Could not create the tree.",
      });
    }
    return interaction.editReply({
      content: `✅ Created squadron **${name || "High General's Command"}** led by <@${targetUser.id}>.\nAdd Generals with \`/squadron add\`.`,
    });
  }

  // --- Recruit → manual override placement under a soldier ---
  if (tier === L.TIER.RECRUIT) {
    if (!parentUser) {
      return interaction.editReply({ content: "❌ Specify the **Imperial Army soldier** (parent) to place this recruit under." });
    }
    const soldierTree = L.findMemberTree(parentUser.id);
    const perm = L.canManage(caller, soldierTree);
    if (!perm.allowed) return interaction.editReply({ content: denyMessage(perm) });

    const res = L.placeRecruitManual(targetUser.id, parentUser.id);
    if (!res.ok) return interaction.editReply({ content: `❌ ${ADD_ERRORS[res.error] || "Could not place recruit."}` });
    return interaction.editReply({ content: `✅ Placed recruit <@${targetUser.id}> under <@${parentUser.id}>.` });
  }

  // --- Officer (general / captain / imperial_army) ---
  let parentId = parentUser ? parentUser.id : null;
  if (tier === L.TIER.GENERAL && !parentId) {
    // Default: the caller's own tree, if they root one.
    const callerTree = L.findMemberTree(interaction.user.id);
    if (callerTree && callerTree.highGeneralId === interaction.user.id) parentId = interaction.user.id;
  }
  if (!parentId) {
    const need =
      tier === L.TIER.GENERAL
        ? "the **High General** to place this General under"
        : tier === L.TIER.CAPTAIN
        ? "the **General** to place this Captain under"
        : "the **Captain** to place this soldier under";
    return interaction.editReply({ content: `❌ Specify ${need} (the \`parent\` option).` });
  }

  const ctx = L.findParentContext(parentId);
  const parentTree = ctx ? ctx.tree : null;
  const perm = L.canManage(caller, parentTree);
  if (!perm.allowed) return interaction.editReply({ content: denyMessage(perm) });

  const res = L.placeOfficer(targetUser.id, tier, parentId);
  if (!res.ok) {
    let extra = "";
    if (res.error === "capacity_full") extra = ` (${tierLabelOf(tier)} limit is ${res.limit}).`;
    if (res.error === "bad_parent_tier") extra = ` This ${tierLabelOf(tier)} must sit under a ${tierLabelOf(L.PARENT_TIER[tier])}.`;
    return interaction.editReply({ content: `❌ ${ADD_ERRORS[res.error] || "Could not place member."}${extra}` });
  }

  return interaction.editReply({
    content: `✅ Placed <@${targetUser.id}> (${tierLabelOf(tier)}) under <@${parentId}>. View it with \`/squadron tree\`.`,
  });
}

// ---- remove ----------------------------------------------------------------

async function handleRemove(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser("member", true);
  const caller = await callerEmpireMember(guild, interaction.user.id);
  if (!caller) {
    return interaction.editReply({ content: "❌ You must be a member of the Yazanaki Empire to manage squadrons." });
  }

  // Determine which tree they belong to (as officer/HG, or as a placed recruit).
  let tree = L.findMemberTree(targetUser.id);
  if (!tree) {
    const rec = L.readInvites()[targetUser.id];
    if (rec && rec.treeId) tree = L.readSquadrons()[rec.treeId] || null;
  }
  if (!tree) {
    return interaction.editReply({ content: `❌ <@${targetUser.id}> isn't in any squadron.` });
  }

  const perm = L.canManage(caller, tree);
  if (!perm.allowed) return interaction.editReply({ content: denyMessage(perm) });

  const res = L.removeMember(targetUser.id);
  if (!res.ok) return interaction.editReply({ content: `❌ Could not remove <@${targetUser.id}>.` });

  const note =
    res.kind === "tree_deleted"
      ? " Their whole squadron was disbanded."
      : res.kind === "officer" && res.removed > 1
      ? ` Their ${res.removed - 1} subordinate(s) were unassigned.`
      : "";
  return interaction.editReply({ content: `✅ Removed <@${targetUser.id}> from the chain of command.${note}` });
}

// ---- rename ----------------------------------------------------------------

async function handleRename(interaction, guild) {
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser("high_general", true);
  const name = interaction.options.getString("name", true);

  const caller = await callerEmpireMember(guild, interaction.user.id);
  if (!caller) {
    return interaction.editReply({ content: "❌ You must be a member of the Yazanaki Empire to manage squadrons." });
  }

  const tree = L.findMemberTree(target.id);
  if (!tree) {
    return interaction.editReply({ content: `❌ <@${target.id}> isn't in any squadron.` });
  }

  const perm = L.canManage(caller, tree);
  if (!perm.allowed) return interaction.editReply({ content: denyMessage(perm) });

  const res = L.renameTree(tree.id, name);
  if (!res.ok) return interaction.editReply({ content: "❌ Could not rename that squadron." });

  return interaction.editReply({ content: `✅ Squadron renamed to **${res.name}**.` });
}

function denyMessage(perm) {
  if (perm.reason === "not_your_tree") return "❌ You can only manage **your own** squadron.";
  return "❌ You need the **Royalty** role or **High General** rank to manage squadrons.";
}

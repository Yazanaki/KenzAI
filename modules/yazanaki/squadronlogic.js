// modules/yazanaki/squadronlogic.js
// Data + logic for the military chain-of-command trees ("squadrons").
//
// One tree per High General:
//   High General (root)
//     └─ Generals            (<= 5 per High General)
//          └─ Captains       (<= 5 per General)
//               └─ Imperial Army soldiers (<= 10 per Captain)
//                    └─ Recruits          (unlimited; auto-sorted by invite)
//
// The OFFICER skeleton (HG -> Generals -> Captains -> Imperial Army) is stored
// explicitly in the `military_squadrons` store. RECRUITS are never stored in a
// tree — each recruit's Imperial Army soldier is *resolved* from who invited
// them (`military_invites` store) and the resolved soldier is persisted so it
// stays stable between renders.

const { stores } = require("../database/stores");
const { loadRolesConfig } = require("../roles/rolesconfig");
const { readMembers } = require("../database/membersPersistence");

const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// Fallback role IDs (used only if a role can't be resolved by name from config).
const HIGH_GENERAL_ROLE_ID = "1334904242795974736";
const ROYALTY_ROLE_ID = "1334642034472128654";

// ---- tier model ------------------------------------------------------------

const TIER = {
  HIGH_GENERAL: "high_general",
  GENERAL: "general",
  CAPTAIN: "captain",
  IMPERIAL_ARMY: "imperial_army",
  RECRUIT: "recruit",
};

const TIER_ORDER = [TIER.HIGH_GENERAL, TIER.GENERAL, TIER.CAPTAIN, TIER.IMPERIAL_ARMY, TIER.RECRUIT];

const TIER_LABEL = {
  high_general: "High General",
  general: "General",
  captain: "Captain",
  imperial_army: "Imperial Army",
  recruit: "Recruit",
};

// Discord rank-role name (lowercased) -> tier key.
const RANK_TO_TIER = {
  "high general": TIER.HIGH_GENERAL,
  general: TIER.GENERAL,
  captain: TIER.CAPTAIN,
  "imperial army": TIER.IMPERIAL_ARMY,
  recruit: TIER.RECRUIT,
};

// Required parent tier for each child tier (adjacency rule).
const PARENT_TIER = {
  general: TIER.HIGH_GENERAL,
  captain: TIER.GENERAL,
  imperial_army: TIER.CAPTAIN,
  recruit: TIER.IMPERIAL_ARMY,
};

// Max children of a given tier under its parent.
const CAPACITY = { general: 5, captain: 5, imperial_army: 10 };

// ---- store accessors -------------------------------------------------------

function readSquadrons() {
  try {
    return stores.military_squadrons.readMap() || {};
  } catch (err) {
    console.error("[squadronlogic] ❌ read squadrons:", err.message);
    return {};
  }
}

function writeSquadrons(map) {
  return stores.military_squadrons.writeMap(map || {});
}

function readInvites() {
  try {
    return stores.military_invites.readMap() || {};
  } catch (err) {
    console.error("[squadronlogic] ❌ read invites:", err.message);
    return {};
  }
}

function writeInvites(map) {
  return stores.military_invites.writeMap(map || {});
}

function genTreeId() {
  return `sqd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---- rank resolution (live from Discord roles) -----------------------------

/**
 * Returns { [roleId]: { name, priority } } for the Empire guild's rankRoles,
 * plus a name->roleId map. Empty maps if config missing.
 */
function getRankRoleData() {
  const config = loadRolesConfig();
  const g = config?.guilds?.[YAZANAKI_EMPIRE_GUILD_ID];
  const rankRoles = (g && g.rankRoles) || {};
  const idByName = {};
  for (const [roleId, data] of Object.entries(rankRoles)) {
    if (data?.name) idByName[data.name.toLowerCase()] = roleId;
  }
  return { rankRoles, idByName };
}

/**
 * Highest-priority military rank NAME a guild member holds (e.g. "Imperial Army"),
 * or null if they hold no configured rank role.
 * @param {GuildMember} member
 * @param {object} rankRoles  { roleId: { name, priority } }
 */
function getMilitaryRankName(member, rankRoles) {
  if (!member?.roles?.cache) return null;
  let best = null;
  let bestPriority = -1;
  for (const roleId of member.roles.cache.keys()) {
    const data = rankRoles[roleId];
    if (data && (data.priority || 0) > bestPriority) {
      bestPriority = data.priority || 0;
      best = data.name;
    }
  }
  return best;
}

/** Rank name -> tier key (or null if the rank isn't part of the military tree). */
function rankNameToTier(rankName) {
  if (!rankName) return null;
  return RANK_TO_TIER[rankName.toLowerCase()] || null;
}

/** Convenience: a guild member's military tier (or null). */
function getMemberTier(member, rankRoles) {
  return rankNameToTier(getMilitaryRankName(member, rankRoles));
}

// ---- tree query helpers ----------------------------------------------------

/** The squadron a member belongs to (as HG root or officer node), or null. */
function findMemberTree(discordId, squadrons = readSquadrons()) {
  for (const sq of Object.values(squadrons)) {
    if (sq.highGeneralId === discordId) return sq;
    if (sq.nodes && sq.nodes[discordId]) return sq;
  }
  return null;
}

/** { tier, parentId } for a member within a tree, or null if absent. */
function findNodeInfo(discordId, squadron) {
  if (!squadron) return null;
  if (discordId === squadron.highGeneralId) return { tier: TIER.HIGH_GENERAL, parentId: null };
  const n = (squadron.nodes || {})[discordId];
  return n ? { tier: n.tier, parentId: n.parentId } : null;
}

/** Locate the tree + node info for a parent id across all trees. */
function findParentContext(parentId, squadrons = readSquadrons()) {
  for (const sq of Object.values(squadrons)) {
    const info = findNodeInfo(parentId, sq);
    if (info) return { tree: sq, info };
  }
  return null;
}

/** Direct child node ids of a parent within a tree. */
function childrenOf(squadron, parentId) {
  return Object.entries(squadron.nodes || {})
    .filter(([, n]) => n.parentId === parentId)
    .map(([id]) => id);
}

/** Count direct children of a given tier under a parent. */
function childCountOfTier(squadron, parentId, tier) {
  return Object.values(squadron.nodes || {}).filter((n) => n.parentId === parentId && n.tier === tier).length;
}

/** All Imperial Army soldier node ids that are descendants of an officer. */
function soldiersInSubtree(squadron, officerId) {
  const out = [];
  const stack = childrenOf(squadron, officerId);
  while (stack.length) {
    const id = stack.pop();
    const n = squadron.nodes[id];
    if (!n) continue;
    if (n.tier === TIER.IMPERIAL_ARMY) out.push(id);
    for (const child of childrenOf(squadron, id)) stack.push(child);
  }
  return out;
}

/** All node ids in the subtree rooted at officerId (excludes officerId). */
function descendantsOf(squadron, officerId) {
  const out = [];
  const stack = childrenOf(squadron, officerId);
  while (stack.length) {
    const id = stack.pop();
    out.push(id);
    for (const child of childrenOf(squadron, id)) stack.push(child);
  }
  return out;
}

/** Placed recruits (from invites) sitting under a given soldier. */
function recruitsUnderSoldier(soldierId, invites = readInvites()) {
  return Object.entries(invites)
    .filter(([, r]) => r && r.status === "placed" && r.soldierId === soldierId)
    .map(([id]) => id);
}

/** Every Imperial Army soldier id across all trees (for validity checks). */
function allSoldierIds(squadrons = readSquadrons()) {
  const set = new Set();
  for (const sq of Object.values(squadrons)) {
    for (const [id, n] of Object.entries(sq.nodes || {})) {
      if (n.tier === TIER.IMPERIAL_ARMY) set.add(id);
    }
  }
  return set;
}

// ---- mutations -------------------------------------------------------------

/** Create a new tree rooted at a High General. */
function createTree(hgId, name, createdBy) {
  const squadrons = readSquadrons();
  if (findMemberTree(hgId, squadrons)) {
    return { ok: false, error: "already_in_tree" };
  }
  const id = genTreeId();
  squadrons[id] = {
    id,
    guildId: YAZANAKI_EMPIRE_GUILD_ID,
    highGeneralId: hgId,
    name: name || null,
    createdBy: createdBy || null,
    createdAt: new Date().toISOString(),
    nodes: {},
  };
  writeSquadrons(squadrons);
  return { ok: true, id };
}

/**
 * Ensure a member who holds the High General role has their own tree. Creates
 * an empty one if missing. Returns the tree object (existing or new), or null
 * if the member isn't a High General / couldn't be created.
 * @param {GuildMember} member
 */
function ensureTreeForMember(member) {
  if (!member || !member.id) return null;
  const existing = findMemberTree(member.id);
  if (existing) return existing;

  const { highGeneralRoleId } = getGovRoleIds();
  if (!highGeneralRoleId) return null;
  if (!member.roles?.cache?.has(highGeneralRoleId)) return null;

  const res = createTree(member.id, null, member.id);
  if (!res.ok) return null;
  return readSquadrons()[res.id] || null;
}

/**
 * Backfill: make sure every current High General in the Empire guild has a tree.
 * Safe to run repeatedly (idempotent). Returns the number of trees created.
 * @param {Client} client
 */
async function ensureHighGeneralTrees(client) {
  try {
    const guild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
    if (!guild) return { created: 0 };

    const { highGeneralRoleId } = getGovRoleIds();
    if (!highGeneralRoleId) return { created: 0 };

    const members = await guild.members.fetch().catch(() => null);
    if (!members) return { created: 0 };

    // Build every missing tree in a single in-memory map and write ONCE. Doing a
    // writeSquadrons() per tree would schedule that many concurrent MySQL
    // replaceAll syncs on the same table and deadlock (they race each other).
    const squadrons = readSquadrons();
    let created = 0;
    for (const m of members.values()) {
      if (m.user?.bot) continue;
      if (!m.roles.cache.has(highGeneralRoleId)) continue;
      if (findMemberTree(m.id, squadrons)) continue; // pass the in-progress map so we don't duplicate
      const id = genTreeId();
      squadrons[id] = {
        id,
        guildId: YAZANAKI_EMPIRE_GUILD_ID,
        highGeneralId: m.id,
        name: null,
        createdBy: m.id,
        createdAt: new Date().toISOString(),
        nodes: {},
      };
      created++;
      console.log(`[squadronlogic] 🎖️ Backfilled squadron ${id} for High General ${m.user.tag} (${m.id})`);
    }
    if (created) {
      writeSquadrons(squadrons); // single write -> single MySQL sync
      console.log(`[squadronlogic] ✅ Ensured ${created} High General tree(s)`);
    }
    return { created };
  } catch (err) {
    console.error("[squadronlogic] ❌ ensureHighGeneralTrees failed:", err.message);
    return { created: 0 };
  }
}

/** Set (or clear) a squadron's display name. */
function renameTree(treeId, name) {
  const squadrons = readSquadrons();
  if (!squadrons[treeId]) return { ok: false, error: "not_found" };
  const clean = name && String(name).trim() ? String(name).trim().slice(0, 100) : null;
  squadrons[treeId].name = clean;
  writeSquadrons(squadrons);
  return { ok: true, name: clean };
}

/**
 * Place an officer (general | captain | imperial_army) under a parent.
 * Validates adjacency + capacity. Blocks if the member is already in a tree.
 */
function placeOfficer(memberId, tier, parentId) {
  if (![TIER.GENERAL, TIER.CAPTAIN, TIER.IMPERIAL_ARMY].includes(tier)) {
    return { ok: false, error: "bad_tier" };
  }
  const squadrons = readSquadrons();

  if (findMemberTree(memberId, squadrons)) {
    return { ok: false, error: "already_in_tree" };
  }

  const ctx = findParentContext(parentId, squadrons);
  if (!ctx) return { ok: false, error: "parent_not_found" };

  const requiredParentTier = PARENT_TIER[tier];
  if (ctx.info.tier !== requiredParentTier) {
    return { ok: false, error: "bad_parent_tier", requiredParentTier, actual: ctx.info.tier };
  }

  const used = childCountOfTier(ctx.tree, parentId, tier);
  if (used >= CAPACITY[tier]) {
    return { ok: false, error: "capacity_full", limit: CAPACITY[tier], used };
  }

  ctx.tree.nodes[memberId] = { parentId, tier, addedAt: new Date().toISOString() };
  writeSquadrons(squadrons);

  // A new soldier may be able to absorb pending recruits.
  if (tier === TIER.IMPERIAL_ARMY) reconcilePending();

  return { ok: true, treeId: ctx.tree.id };
}

/**
 * Manual recruit override — place a recruit directly under a specific soldier.
 * Records/updates the recruit's invite entry as a manual placement.
 */
function placeRecruitManual(memberId, soldierId) {
  const squadrons = readSquadrons();
  let tree = null;
  for (const sq of Object.values(squadrons)) {
    const n = (sq.nodes || {})[soldierId];
    if (n && n.tier === TIER.IMPERIAL_ARMY) {
      tree = sq;
      break;
    }
  }
  if (!tree) return { ok: false, error: "target_not_soldier" };

  const invites = readInvites();
  const prev = invites[memberId] || {};
  invites[memberId] = {
    ...prev,
    inviterId: prev.inviterId || null,
    soldierId,
    treeId: tree.id,
    status: "placed",
    manual: true,
    at: prev.at || new Date().toISOString(),
  };
  writeInvites(invites);
  return { ok: true, treeId: tree.id };
}

/**
 * Remove a member from their tree. If they are the High General the whole tree
 * is deleted. Officer removals cascade to their officer descendants (which
 * become unassigned). Any recruits under removed soldiers are re-resolved.
 */
function removeMember(memberId) {
  const squadrons = readSquadrons();

  // Recruit removal (they live in invites, not nodes).
  const invites = readInvites();
  const asRecruit = invites[memberId];
  const tree = findMemberTree(memberId, squadrons);

  if (!tree) {
    if (asRecruit && asRecruit.status === "placed") {
      asRecruit.status = "pending";
      asRecruit.soldierId = null;
      asRecruit.treeId = null;
      writeInvites(invites);
      return { ok: true, kind: "recruit" };
    }
    return { ok: false, error: "not_in_tree" };
  }

  if (tree.highGeneralId === memberId) {
    const removedIds = [tree.highGeneralId, ...Object.keys(tree.nodes || {})];
    delete squadrons[tree.id];
    writeSquadrons(squadrons);
    detachRecruitsFor(removedIds);
    return { ok: true, kind: "tree_deleted", removed: removedIds.length };
  }

  const removed = [memberId, ...descendantsOf(tree, memberId)];
  for (const id of removed) delete tree.nodes[id];
  writeSquadrons(squadrons);
  detachRecruitsFor(removed);
  return { ok: true, kind: "officer", removed: removed.length };
}

/** Reset any recruits placed under the given (now-removed) ids, then reconcile. */
function detachRecruitsFor(removedIds) {
  const set = new Set(removedIds);
  const invites = readInvites();
  let touched = false;
  for (const rec of Object.values(invites)) {
    if (rec && rec.status === "placed" && set.has(rec.soldierId)) {
      rec.status = "pending";
      rec.soldierId = null;
      rec.treeId = null;
      touched = true;
    }
  }
  if (touched) writeInvites(invites);
  reconcilePending();
}

// ---- recruit resolution ----------------------------------------------------

/**
 * Core placement decision operating purely on in-memory maps (no store I/O).
 * Mutates invites[recruitId] and returns true if anything changed. Shared by
 * resolveRecruitPlacement (single write) and reconcilePending (one batched
 * write) so bulk reconciles don't fire many concurrent MySQL syncs (which
 * deadlock on the same table).
 *
 * Placement rule, based on who invited the recruit:
 *   inviter is a soldier            -> directly under that soldier
 *   inviter is Captain/General/HG   -> least-loaded soldier in the inviter's subtree
 *   inviter is a placed recruit     -> the same soldier the inviting recruit is under
 *   otherwise / no soldier available -> pending
 */
function _resolvePlacementInto(recruitId, invites, squadrons, members) {
  const rec = invites[recruitId];
  if (!rec || !rec.inviterId) return false;

  // Manual placements are left untouched as long as they stay valid.
  if (rec.manual && rec.status === "placed" && rec.soldierId && allSoldierIds(squadrons).has(rec.soldierId)) {
    return false;
  }

  // Only accepted members who currently hold the Recruit rank belong in a tree.
  // military_invites records EVERY join through an invite link, so without this
  // gate people who were invited but never accepted (or who left, or were
  // promoted past Recruit) would be placed as phantom recruits.
  if (!isRecruitMember(recruitId, members)) {
    const changed = rec.status === "placed" || !!rec.soldierId || !!rec.treeId;
    rec.status = "pending";
    rec.soldierId = null;
    rec.treeId = null;
    return changed;
  }

  const inviterId = rec.inviterId;
  let soldierId = null;
  let treeId = null;

  const inviterTree = findMemberTree(inviterId, squadrons);
  if (inviterTree) {
    const info = findNodeInfo(inviterId, inviterTree);
    if (info.tier === TIER.IMPERIAL_ARMY) {
      soldierId = inviterId;
      treeId = inviterTree.id;
    } else {
      // Officer above Imperial Army -> pick one of their subtree soldiers.
      const soldiers = soldiersInSubtree(inviterTree, inviterId);
      const pick = leastLoadedSoldier(soldiers, invites);
      if (pick) {
        soldierId = pick;
        treeId = inviterTree.id;
      }
    }
  } else {
    // Inviter might be a recruit themselves -> share their soldier.
    const inviterRec = invites[inviterId];
    if (inviterRec && inviterRec.status === "placed" && inviterRec.soldierId) {
      soldierId = inviterRec.soldierId;
      treeId = inviterRec.treeId;
    }
  }

  const newStatus = soldierId ? "placed" : "pending";
  const newSoldier = soldierId || null;
  const newTree = soldierId ? treeId : null;
  if (rec.status === newStatus && rec.soldierId === newSoldier && rec.treeId === newTree) {
    return false;
  }
  rec.status = newStatus;
  rec.soldierId = newSoldier;
  rec.treeId = newTree;
  return true;
}

/** True if the member is an accepted member currently holding the Recruit rank. */
function isRecruitMember(id, members) {
  const m = members && members[id];
  if (!m) return false;
  return String(m.YazanakiRank || "").trim().toLowerCase() === "recruit";
}

/** Resolve (and persist) a single recruit's Imperial Army soldier. */
function resolveRecruitPlacement(recruitId) {
  const invites = readInvites();
  const rec = invites[recruitId];
  if (!rec || !rec.inviterId) return { ok: false, reason: "no_inviter" };

  const squadrons = readSquadrons();
  const members = readMembers();
  const changed = _resolvePlacementInto(recruitId, invites, squadrons, members);
  if (changed) writeInvites(invites);
  return { ok: true, status: rec.status, soldierId: rec.soldierId, treeId: rec.treeId };
}

/** Soldier id with the fewest placed recruits; stable tie-break by id. */
function leastLoadedSoldier(soldierIds, invites) {
  if (!soldierIds || !soldierIds.length) return null;
  const counts = {};
  for (const id of soldierIds) counts[id] = 0;
  for (const r of Object.values(invites)) {
    if (r && r.status === "placed" && counts[r.soldierId] != null) counts[r.soldierId] += 1;
  }
  return [...soldierIds].sort((a, b) => counts[a] - counts[b] || (a < b ? -1 : 1))[0];
}

/**
 * Re-resolve every recruit that is pending or whose stored soldier no longer
 * exists. Placed recruits with a still-valid soldier are left alone (stability).
 */
function reconcilePending() {
  const invites = readInvites();
  const squadrons = readSquadrons();
  const members = readMembers();
  const validSoldiers = allSoldierIds(squadrons);
  let changed = 0;
  for (const [id, rec] of Object.entries(invites)) {
    if (!rec || !rec.inviterId) continue;
    // Re-evaluate anything not cleanly placed under a valid soldier, and any
    // currently-placed record whose invitee is no longer an eligible recruit
    // (so phantom placements from earlier get cleaned up).
    const stale =
      rec.status !== "placed" ||
      !rec.soldierId ||
      !validSoldiers.has(rec.soldierId) ||
      !isRecruitMember(id, members);
    if (stale && _resolvePlacementInto(id, invites, squadrons, members)) changed++;
  }
  if (changed) writeInvites(invites); // one write -> one MySQL sync
  return changed;
}

/**
 * Record invite attribution at join time (called from pointsevents.js). Does
 * NOT resolve placement yet — the joiner becomes a recruit only on acceptance.
 * A clan-guild attribution takes precedence over an Empire-guild one.
 */
function recordInvite(joinerId, { inviterId, guildId, clanAbbr } = {}) {
  if (!joinerId || !inviterId) return false;
  const invites = readInvites();
  const prev = invites[joinerId];
  const incomingIsClan = clanAbbr && clanAbbr !== "YZNK";
  const prevIsClan = prev && prev.clanAbbr && prev.clanAbbr !== "YZNK";
  // Keep an existing clan attribution over a fresh Empire-guild one.
  if (prev && prevIsClan && !incomingIsClan) return false;

  invites[joinerId] = {
    inviterId,
    guildId: guildId || null,
    clanAbbr: clanAbbr || null,
    at: new Date().toISOString(),
    soldierId: prev?.soldierId || null,
    treeId: prev?.treeId || null,
    status: prev?.status || "pending",
    manual: prev?.manual || false,
  };
  writeInvites(invites);
  return true;
}

// ---- permissions -----------------------------------------------------------

/** Resolve the Royalty status role id and High General rank role id from config. */
function getGovRoleIds() {
  const config = loadRolesConfig();
  const g = config?.guilds?.[YAZANAKI_EMPIRE_GUILD_ID] || {};
  let royaltyRoleId = ROYALTY_ROLE_ID;
  let highGeneralRoleId = HIGH_GENERAL_ROLE_ID;
  for (const [roleId, data] of Object.entries(g.statusRoles || {})) {
    if (data?.name && data.name.toLowerCase() === "royalty") royaltyRoleId = roleId;
  }
  for (const [roleId, data] of Object.entries(g.rankRoles || {})) {
    if (data?.name && data.name.toLowerCase() === "high general") highGeneralRoleId = roleId;
  }
  return { royaltyRoleId, highGeneralRoleId };
}

/**
 * Can this member manage the given tree?
 *   Royalty      -> any tree (and can create/root new ones)
 *   High General -> only the tree they root (squadron.highGeneralId === them)
 * @param {GuildMember} member
 * @param {object|null} squadron  the target tree, or null for "create a tree"
 */
function canManage(member, squadron) {
  if (!member?.roles?.cache) return { allowed: false, reason: "no_member" };
  const { royaltyRoleId, highGeneralRoleId } = getGovRoleIds();

  if (member.roles.cache.has(royaltyRoleId)) return { allowed: true };

  const isHighGeneral = member.roles.cache.has(highGeneralRoleId);
  if (isHighGeneral) {
    // High Generals manage only their own tree. For "create", they can root
    // themselves (squadron === null and the target HG is them — checked by caller).
    if (!squadron) return { allowed: true, scope: "own" };
    if (squadron.highGeneralId === member.id) return { allowed: true, scope: "own" };
    return { allowed: false, reason: "not_your_tree" };
  }

  return { allowed: false, reason: "insufficient_role" };
}

// ---- render models ---------------------------------------------------------

/**
 * Build a render tree (root = HG) including recruits attached to their soldiers.
 * @param {object} squadron
 * @param {object} invites
 * @param {object} opts { info, colorByTier, includeRecruit }
 *   includeRecruit(id) -> boolean gate applied to recruit nodes (default: all).
 *   Use it to only render recruits who are real current members.
 */
function buildTreeModel(squadron, invites = readInvites(), opts = {}) {
  const info = opts.info || (() => ({}));
  const colorByTier = opts.colorByTier || {};
  const includeRecruit = opts.includeRecruit || (() => true);
  const nodes = squadron.nodes || {};

  function make(id, tier) {
    const meta = info(id) || {};
    return {
      id,
      tier,
      name: meta.name || `User ${id}`,
      avatarURL: meta.avatarURL || null,
      present: meta.present !== false,
      color: colorByTier[tier] || null,
      children: [],
    };
  }

  function attach(node) {
    const kids = Object.entries(nodes)
      .filter(([, n]) => n.parentId === node.id)
      .map(([cid, n]) => make(cid, n.tier));
    // Deterministic order: by tier then name.
    kids.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.name.localeCompare(b.name));
    for (const k of kids) {
      attach(k);
      node.children.push(k);
    }
    if (node.tier === TIER.IMPERIAL_ARMY) {
      const recs = Object.entries(invites)
        .filter(
          ([rid, r]) =>
            r && r.status === "placed" && r.soldierId === node.id && r.treeId === squadron.id && !nodes[rid] && includeRecruit(rid)
        )
        .map(([rid]) => make(rid, TIER.RECRUIT));
      recs.sort((a, b) => a.name.localeCompare(b.name));
      for (const r of recs) node.children.push(r);
    }
  }

  const root = make(squadron.highGeneralId, TIER.HIGH_GENERAL);
  attach(root);
  return root;
}

/**
 * Context for a "personal chain" view: the ancestry from the member up to the
 * High General plus the member's direct subordinates.
 * @returns {object|null} { tree, memberId, selfTier, ancestors:[ids top->parent], children:[{id,tier}] }
 */
function getMemberContext(memberId) {
  const squadrons = readSquadrons();
  const invites = readInvites();

  let tree = findMemberTree(memberId, squadrons);
  let selfTier;
  let selfParentId;

  if (tree) {
    const ninfo = findNodeInfo(memberId, tree);
    selfTier = ninfo.tier;
    selfParentId = ninfo.parentId;
  } else {
    const rec = invites[memberId];
    if (rec && rec.status === "placed" && rec.treeId && squadrons[rec.treeId]) {
      tree = squadrons[rec.treeId];
      selfTier = TIER.RECRUIT;
      selfParentId = rec.soldierId;
    } else {
      return null;
    }
  }

  // Walk from the parent up to the HG root.
  const ancestors = [];
  let cur = selfParentId;
  const guard = new Set();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    ancestors.unshift(cur);
    const info = findNodeInfo(cur, tree);
    cur = info ? info.parentId : null;
  }

  // Direct subordinates of the member.
  let children = [];
  if (selfTier === TIER.IMPERIAL_ARMY) {
    children = Object.entries(invites)
      .filter(([, r]) => r && r.status === "placed" && r.soldierId === memberId && r.treeId === tree.id)
      .map(([id]) => ({ id, tier: TIER.RECRUIT }));
  } else if (selfTier !== TIER.RECRUIT) {
    children = Object.entries(tree.nodes || {})
      .filter(([, n]) => n.parentId === memberId)
      .map(([id, n]) => ({ id, tier: n.tier }));
  }

  return { tree, memberId, selfTier, ancestors, children };
}

/**
 * Build a linear "personal chain" render model: High General -> ... -> member,
 * with the member's direct subordinates hung under them. Same node shape as
 * buildTreeModel. Returns { model, selfId, tree } or null.
 */
function buildChainModel(memberId, opts = {}) {
  const ctx = getMemberContext(memberId);
  if (!ctx) return null;

  const info = opts.info || (() => ({}));
  const colorByTier = opts.colorByTier || {};
  const includeRecruit = opts.includeRecruit || (() => true);
  const make = (id, tier) => {
    const meta = info(id) || {};
    return {
      id,
      tier,
      name: meta.name || `User ${id}`,
      avatarURL: meta.avatarURL || null,
      present: meta.present !== false,
      color: colorByTier[tier] || null,
      children: [],
    };
  };

  const chainIds = [...ctx.ancestors, ctx.memberId];
  let root = null;
  let prev = null;
  for (const id of chainIds) {
    const tier = id === ctx.memberId ? ctx.selfTier : (findNodeInfo(id, ctx.tree) || {}).tier;
    const node = make(id, tier);
    if (!root) root = node;
    else prev.children.push(node);
    prev = node;
  }
  for (const c of ctx.children) {
    if (c.tier === TIER.RECRUIT && !includeRecruit(c.id)) continue;
    prev.children.push(make(c.id, c.tier));
  }

  return { model: root, selfId: ctx.memberId, tree: ctx.tree };
}

/** Count real members per tier in a squadron (officers from nodes, recruits filtered). */
function countMembers(squadron, invites = readInvites(), includeRecruit = () => true) {
  const counts = { general: 0, captain: 0, imperial_army: 0, recruit: 0 };
  const nodes = squadron.nodes || {};
  for (const n of Object.values(nodes)) if (counts[n.tier] != null) counts[n.tier] += 1;
  for (const [rid, r] of Object.entries(invites)) {
    if (r && r.status === "placed" && r.treeId === squadron.id && !nodes[rid] && includeRecruit(rid)) counts.recruit += 1;
  }
  counts.total = 1 + counts.general + counts.captain + counts.imperial_army + counts.recruit;
  return counts;
}

/**
 * Build a COMPACT render model for a large squadron, focused on one member.
 *   - Viewing the High General: show HG -> Generals -> Captains in full, and
 *     bundle each Captain's Imperial Soldiers + Recruits into one chip.
 *   - Viewing anyone lower: show the spine (HG -> focus) in full, bundle the
 *     off-path siblings at each level, and expand the focus's own downline
 *     (a Captain shows all soldiers + recruits; a General shows its captains
 *     with soldier/recruit chips; a Soldier shows its recruits).
 * Bundle node: { id:"bundle:*", tier, bundle:true, count, name, sub?, ... }.
 */
function buildCompactModel(squadron, focusId, invites = readInvites(), opts = {}) {
  const info = opts.info || (() => ({}));
  const colorByTier = opts.colorByTier || {};
  const includeRecruit = opts.includeRecruit || (() => true);
  const nodes = squadron.nodes || {};
  const PLURAL = { general: "Generals", captain: "Captains", imperial_army: "Soldiers", recruit: "Recruits" };

  const make = (id, tier) => {
    const meta = info(id) || {};
    return {
      id,
      tier,
      name: meta.name || `User ${id}`,
      avatarURL: meta.avatarURL || null,
      present: meta.present !== false,
      color: colorByTier[tier] || null,
      children: [],
    };
  };
  const bundleNode = (key, tier, extra) => ({
    id: `bundle:${key}`,
    tier,
    bundle: true,
    present: true,
    color: colorByTier[tier] || null,
    children: [],
    ...extra,
  });

  const recruitsUnder = (soldierId) =>
    Object.keys(invites).filter((rid) => {
      const r = invites[rid];
      return r && r.status === "placed" && r.soldierId === soldierId && r.treeId === squadron.id && !nodes[rid] && includeRecruit(rid);
    });

  // One chip summarizing a captain's soldiers + recruits (or null if none).
  const soldierChip = (captainId) => {
    const soldiers = childrenOf(squadron, captainId).filter((cid) => nodes[cid].tier === TIER.IMPERIAL_ARMY);
    let rc = 0;
    for (const s of soldiers) rc += recruitsUnder(s).length;
    if (!soldiers.length && !rc) return null;
    return bundleNode(`${captainId}:below`, TIER.IMPERIAL_ARMY, {
      name: `${soldiers.length} ${soldiers.length === 1 ? "Soldier" : "Soldiers"}`,
      sub: rc ? `${rc} ${rc === 1 ? "Recruit" : "Recruits"}` : null,
      count: soldiers.length,
    });
  };

  // Full subtree under an officer (everyone shown).
  const buildFull = (id, tier) => {
    const n = make(id, tier);
    for (const cid of childrenOf(squadron, id)) n.children.push(buildFull(cid, nodes[cid].tier));
    if (tier === TIER.IMPERIAL_ARMY) for (const rid of recruitsUnder(id)) n.children.push(make(rid, TIER.RECRUIT));
    return n;
  };

  // Officer subtree but with soldiers + recruits collapsed into a chip per captain.
  const buildBundledBelow = (id, tier) => {
    const n = make(id, tier);
    if (tier === TIER.CAPTAIN) {
      const chip = soldierChip(id);
      if (chip) n.children.push(chip);
      return n;
    }
    for (const cid of childrenOf(squadron, id)) n.children.push(buildBundledBelow(cid, nodes[cid].tier));
    return n;
  };

  // Resolve focus tier (recruits live in invites, not nodes).
  const recInfo = invites[focusId];
  let focusTier;
  if (nodes[focusId]) focusTier = nodes[focusId].tier;
  else if (focusId === squadron.highGeneralId) focusTier = TIER.HIGH_GENERAL;
  else if (recInfo && recInfo.status === "placed" && recInfo.treeId === squadron.id) focusTier = TIER.RECRUIT;
  else focusTier = TIER.HIGH_GENERAL;

  // Overview: focus is the High General.
  if (focusTier === TIER.HIGH_GENERAL) return buildBundledBelow(squadron.highGeneralId, TIER.HIGH_GENERAL);

  // Build the spine from HG down to the focus.
  const spine = [];
  {
    let cur = focusTier === TIER.RECRUIT ? recInfo.soldierId : focusId;
    const guard = new Set();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      spine.unshift(cur);
      const inf = findNodeInfo(cur, squadron);
      cur = inf ? inf.parentId : null;
    }
    if (focusTier === TIER.RECRUIT) spine.push(focusId);
  }
  const tierOf = (id) => (id === focusId && focusTier === TIER.RECRUIT ? TIER.RECRUIT : (findNodeInfo(id, squadron) || {}).tier);
  const spineNodes = spine.map((id) => make(id, tierOf(id)));
  for (let i = 0; i < spineNodes.length - 1; i++) spineNodes[i].children.push(spineNodes[i + 1]);

  // Off-path sibling chips at each spine level (children of the spine node that
  // are not the next spine node), grouped by tier.
  for (let i = 0; i < spine.length - 1; i++) {
    const id = spine[i];
    const nextId = spine[i + 1];
    const offByTier = {};
    if (tierOf(id) === TIER.IMPERIAL_ARMY) {
      for (const rid of recruitsUnder(id)) if (rid !== nextId) (offByTier[TIER.RECRUIT] ||= []).push(rid);
    } else {
      for (const cid of childrenOf(squadron, id)) if (cid !== nextId) (offByTier[nodes[cid].tier] ||= []).push(cid);
    }
    for (const [ct, arr] of Object.entries(offByTier)) {
      spineNodes[i].children.push(bundleNode(`${id}:${ct}`, ct, { name: `+${arr.length} ${PLURAL[ct]}`, count: arr.length }));
    }
  }

  // Expand the focus's own downline.
  const focusNode = spineNodes[spineNodes.length - 1];
  if (focusTier === TIER.GENERAL) {
    for (const cid of childrenOf(squadron, focusId)) focusNode.children.push(buildBundledBelow(cid, TIER.CAPTAIN));
  } else if (focusTier === TIER.CAPTAIN) {
    for (const cid of childrenOf(squadron, focusId)) focusNode.children.push(buildFull(cid, TIER.IMPERIAL_ARMY));
  } else if (focusTier === TIER.IMPERIAL_ARMY) {
    for (const rid of recruitsUnder(focusId)) focusNode.children.push(make(rid, TIER.RECRUIT));
  }

  return spineNodes[0];
}

/** Summary rows for `/squadron list`. */
function listTrees() {
  const squadrons = readSquadrons();
  const invites = readInvites();
  return Object.values(squadrons).map((sq) => {
    const counts = { general: 0, captain: 0, imperial_army: 0 };
    for (const n of Object.values(sq.nodes || {})) {
      if (counts[n.tier] != null) counts[n.tier] += 1;
    }
    const recruits = Object.values(invites).filter((r) => r && r.status === "placed" && r.treeId === sq.id).length;
    return { squadron: sq, counts, recruits };
  });
}

module.exports = {
  // constants
  YAZANAKI_EMPIRE_GUILD_ID,
  TIER,
  TIER_ORDER,
  TIER_LABEL,
  RANK_TO_TIER,
  PARENT_TIER,
  CAPACITY,
  // stores
  readSquadrons,
  writeSquadrons,
  readInvites,
  writeInvites,
  // rank
  getRankRoleData,
  getMilitaryRankName,
  rankNameToTier,
  getMemberTier,
  // queries
  findMemberTree,
  findNodeInfo,
  findParentContext,
  childrenOf,
  childCountOfTier,
  soldiersInSubtree,
  recruitsUnderSoldier,
  allSoldierIds,
  // mutations
  createTree,
  ensureTreeForMember,
  ensureHighGeneralTrees,
  renameTree,
  placeOfficer,
  placeRecruitManual,
  removeMember,
  // recruit resolution
  resolveRecruitPlacement,
  reconcilePending,
  recordInvite,
  // permissions
  getGovRoleIds,
  canManage,
  // render models
  buildTreeModel,
  buildChainModel,
  buildCompactModel,
  countMembers,
  getMemberContext,
  listTrees,
};

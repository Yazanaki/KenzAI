// modules/applications/acceptedapplicants.js
// ✅ COMPLETE: Assigns roles in BOTH Yazanaki discord AND clan discord
// ✅ BLOCKS acceptance if user is not in Yazanaki Empire
// ✅ FIXED: Properly initializes draft fields when creating member entry
// ✅ NEW: Additional check to prevent duplicate acceptance processing
// ✅ NEW: Increments clan resident count on acceptance

const { readMembers, writeMembers } = require("../database/membersPersistence");
const { readClans } = require("../database/clansPersistence");
const { getApplicant } = require("./applicants");

// Yazanaki Empire Guild ID
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// Role IDs from Yazanaki Empire
const ROLES = {
  MILITARY: "1334641887017177141",
  RECRUIT: "1345398371522842624",  // Draft role
  CITIZEN: "1334641779009519668"
};

// "Random" role in Yazanaki Empire (used for unassigned / provisional members)
const YAZANAKI_RANDOM_ROLE_ID = "1334846750707421194";

// ✅ Import clan resident management
const { incrementClanResidents } = require("../clantracking/clanlogic");
const { onResidentAdded: onStockResidentAdded } = require("../stock/stocklogic");

function formatDate(dateString) {
  const d = new Date(dateString);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

const { assignEmpireId } = require("../empire/empireid");
const { startDraft } = require("../empire/draftlogic");
const config = require("../empire/draftconfig");

/**
 * ✅ STEP 1: Verify user is in Yazanaki Empire (BLOCKS acceptance if not)
 */
async function checkInYazanaki(client, discordId) {
  console.log(`[acceptedapps] 🔍 STEP 1: Checking if user is in Yazanaki Empire...`);
  
  try {
    const yazanakiGuild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
    
    if (!yazanakiGuild) {
      console.error(`[acceptedapps] ❌ Could not fetch Yazanaki Empire guild`);
      return { inGuild: false, reason: "yazanaki_guild_not_found" };
    }
    
    const member = await yazanakiGuild.members.fetch(discordId).catch(() => null);
    
    if (!member) {
      console.error(`[acceptedapps] ❌ User ${discordId} is NOT in Yazanaki Empire`);
      return { inGuild: false, reason: "not_in_yazanaki" };
    }
    
    console.log(`[acceptedapps] ✅ User is in Yazanaki Empire: ${member.user.tag}`);
    return { inGuild: true, member };
    
  } catch (err) {
    console.error(`[acceptedapps] ❌ Error checking Yazanaki membership:`, err);
    return { inGuild: false, reason: "error", error: err.message };
  }
}

/**
 * ✅ STEP 2: Assign roles in Yazanaki Empire
 * Gives: Military + Recruit (Draft) + Clan role
 */
async function assignYazanakiRoles(client, discordId, clanGuildId) {
  console.log(`[acceptedapps] 🎭 STEP 2: Assigning Yazanaki Empire roles...`);
  
  try {
    const clans = readClans();
    const clan = clans[clanGuildId];
    
    if (!clan) {
      console.error(`[acceptedapps] ❌ Clan not found for guild ${clanGuildId}`);
      console.error(`[acceptedapps] ❌ Use /clan add to register this clan first`);
      return { success: false, reason: "clan_not_registered" };
    }
    
    if (!clan.yazanakiRoleId) {
      console.error(`[acceptedapps] ❌ Clan ${clan.abbr} has no yazanakiRoleId configured`);
      console.error(`[acceptedapps] ❌ Use /clan setrole clan:${clan.abbr} type:Yazanaki to set the role`);
      return { success: false, reason: "no_yazanaki_role_configured", clan };
    }
    
    console.log(`[acceptedapps] 🏷️ Clan: ${clan.abbr} (${clan.name})`);
    console.log(`[acceptedapps] 🏷️ Yazanaki Role ID: ${clan.yazanakiRoleId}`);
    
    const yazanakiGuild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
    
    if (!yazanakiGuild) {
      console.error(`[acceptedapps] ❌ Could not fetch Yazanaki Empire guild`);
      return { success: false, reason: "yazanaki_guild_not_found", clan };
    }
    
    const member = await yazanakiGuild.members.fetch(discordId).catch(() => null);
    
    if (!member) {
      console.error(`[acceptedapps] ❌ User ${discordId} not in Yazanaki Empire`);
      return { success: false, reason: "not_in_yazanaki", clan };
    }
    
    console.log(`[acceptedapps] ✅ Found member: ${member.user.tag}`);

    // ------------------------------------------------------------
    // Remove any "Random" role from Yazanaki Empire for this user
    // ------------------------------------------------------------
    try {
      // Prefer explicit ID, but also fall back to name-based in case of changes
      const randomRolesToRemove = [];

      if (YAZANAKI_RANDOM_ROLE_ID) {
        const randomById = yazanakiGuild.roles.cache.get(YAZANAKI_RANDOM_ROLE_ID);
        if (randomById && member.roles.cache.has(randomById.id)) {
          randomRolesToRemove.push(randomById);
        }
      }

      // Also catch any role literally named "Random" (case-insensitive)
      yazanakiGuild.roles.cache.forEach((role) => {
        if (!role || !role.name) return;
        if (role.name.toLowerCase() === "random" && member.roles.cache.has(role.id)) {
          if (!randomRolesToRemove.find((r) => r.id === role.id)) {
            randomRolesToRemove.push(role);
          }
        }
      });

      for (const role of randomRolesToRemove) {
        await member.roles.remove(role.id);
        console.log(`[acceptedapps] ✅ Removed Yazanaki "Random" role (${role.id})`);
      }

      if (!randomRolesToRemove.length) {
        console.log("[acceptedapps] ℹ️ No Yazanaki \"Random\" role to remove for this member");
      }
    } catch (err) {
      console.warn("[acceptedapps] ⚠️ Failed to remove Yazanaki \"Random\" role(s):", err.message);
    }
    
    // Assign roles: Military, Recruit (Draft), and Clan role
    const rolesToAdd = [
      { id: ROLES.MILITARY, name: "Military" },
      { id: ROLES.RECRUIT, name: "Recruit" },
      { id: clan.yazanakiRoleId, name: clan.abbr }
    ];
    
    for (const role of rolesToAdd) {
      if (member.roles.cache.has(role.id)) {
        console.log(`[acceptedapps] ℹ️ Already has ${role.name} role`);
        continue;
      }
      
      try {
        await member.roles.add(role.id);
        console.log(`[acceptedapps] ✅ Assigned ${role.name} role`);
      } catch (err) {
        console.error(`[acceptedapps] ❌ Failed to assign ${role.name}:`, err.message);
      }
    }
    
    console.log(`[acceptedapps] ✅ All Yazanaki Empire roles assigned!`);
    return { success: true, clan };
    
  } catch (err) {
    console.error(`[acceptedapps] ❌ Error assigning Yazanaki roles:`, err);
    return { success: false, reason: "error", error: err.message };
  }
}

/**
 * ✅ STEP 3: Assign role in clan's own discord
 */
async function assignClanRole(client, discordId, clanGuildId, clan) {
  console.log(`[acceptedapps] 🎭 STEP 3: Assigning role in clan discord (${clan.abbr})...`);
  
  if (!clan.clanRoleId) {
    console.warn(`[acceptedapps] ⚠️ Clan ${clan.abbr} has no clanRoleId configured`);
    console.warn(`[acceptedapps] ⚠️ Use /clan setrole clan:${clan.abbr} type:Clan to set it`);
    console.warn(`[acceptedapps] ⚠️ Skipping clan discord role assignment`);
    return { success: false, reason: "no_clan_role_configured" };
  }
  
  try {
    const clanGuild = await client.guilds.fetch(clanGuildId).catch(() => null);
    
    if (!clanGuild) {
      console.warn(`[acceptedapps] ⚠️ Could not fetch clan guild ${clanGuildId}`);
      return { success: false, reason: "clan_guild_not_found" };
    }
    
    console.log(`[acceptedapps] ✅ Fetched clan guild: ${clanGuild.name}`);
    
    const member = await clanGuild.members.fetch(discordId).catch(() => null);
    
    if (!member) {
      console.warn(`[acceptedapps] ⚠️ User not in clan guild ${clanGuild.name}`);
      console.warn(`[acceptedapps] ⚠️ They can join the clan discord later`);
      return { success: false, reason: "not_in_clan_guild" };
    }
    
    console.log(`[acceptedapps] ✅ Found member in clan guild: ${member.user.tag}`);

    // ------------------------------------------------------------
    // Remove any "Random" role from the clan guild for this user
    // (role name must be exactly 'Random' ignoring case)
    // ------------------------------------------------------------
    try {
      const randomRoles = clanGuild.roles.cache.filter(
        (role) => role && role.name && role.name.toLowerCase() === "random"
      );

      if (randomRoles.size) {
        for (const role of randomRoles.values()) {
          if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role.id);
            console.log(
              `[acceptedapps] ✅ Removed clan "Random" role (${role.id}) in guild ${clanGuild.id}`
            );
          }
        }
      } else {
        console.log(
          `[acceptedapps] ℹ️ No clan role named "Random" found in guild ${clanGuild.id}`
        );
      }
    } catch (err) {
      console.warn("[acceptedapps] ⚠️ Failed to remove clan \"Random\" role(s):", err.message);
    }
    
    if (member.roles.cache.has(clan.clanRoleId)) {
      console.log(`[acceptedapps] ℹ️ Member already has clan role`);
    } else {
      await member.roles.add(clan.clanRoleId);
      console.log(`[acceptedapps] ✅ Assigned clan role in clan discord`);
    }
    
    return { success: true };
    
  } catch (err) {
    console.error(`[acceptedapps] ❌ Error assigning clan role:`, err);
    return { success: false, reason: "error", error: err.message };
  }
}

/**
 * ✅ MAIN ACCEPTANCE FUNCTION
 * Order:
 * 0. CHECK if already a member (prevent duplicates)
 * 1. CHECK if user is in Yazanaki Empire (BLOCKS if not)
 * 2. Assign Yazanaki Empire roles (Military + Recruit + Clan role)
 * 3. Assign role in clan's own discord (optional)
 * 4. Assign Empire ID
 * 5. Create member entry in members.json with ALL required fields
 * 6. Start draft (which updates the existing member entry)
 * 7. ✅ NEW: Increment clan resident count
 */
module.exports.acceptApplicant = async function (discordId, client = null) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[acceptedapps] 🎯 Accepting applicant ${discordId}`);

  if (!client) {
    console.error(`[acceptedapps] ❌ Client not provided`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: "no_client" };
  }

  const members = readMembers();
  const data = getApplicant(discordId);

  if (!data) {
    console.log(`[acceptedapps] ❌ Applicant not found`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: "applicant_not_found" };
  }

  if (!data.accepted) {
    console.log(`[acceptedapps] ⚠️ Applicant not marked as accepted`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: "not_accepted" };
  }

  // ============================================================
  // ✅ NEW: CHECK IF ALREADY A MEMBER (PREVENT DUPLICATE PROCESSING)
  // ============================================================
  if (members[discordId]) {
    const existingMember = members[discordId];
    console.log(`[acceptedapps] ⚠️ User is already a member!`);
    console.log(`[acceptedapps] 📅 Original join date: ${existingMember.JoinDate}`);
    console.log(`[acceptedapps] 🆔 Empire ID: ${existingMember.EmpireID}`);
    console.log(`[acceptedapps] 🏷️ Clan: ${existingMember.JoinedClan}`);
    console.log(`[acceptedapps] ❌ BLOCKING duplicate acceptance`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    return { 
      success: false, 
      reason: "already_member",
      existingData: {
        joinDate: existingMember.JoinDate,
        empireId: existingMember.EmpireID,
        clan: existingMember.JoinedClan
      }
    };
  }

  const discordUser = data.discordUser || "";
  const minecraftUser = data.minecraftUser || "";
  const minecraftVersion = data.minecraftVersion || "";
  const clanGuildId = data.server;

  console.log(`[acceptedapps] 📊 Applicant: ${discordUser}`);
  console.log(`[acceptedapps] 🎮 Minecraft: ${minecraftUser}`);
  console.log(`[acceptedapps] 🏷️ Clan Guild: ${clanGuildId}`);

  // ============================================================
  // STEP 1: CHECK IF IN YAZANAKI EMPIRE (BLOCKING)
  // ============================================================
  const yazanakiCheck = await checkInYazanaki(client, discordId);
  
  if (!yazanakiCheck.inGuild) {
    console.error(`[acceptedapps] ❌ CRITICAL: User is NOT in Yazanaki Empire!`);
    console.error(`[acceptedapps] ❌ Acceptance BLOCKED`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: "not_in_yazanaki" };
  }

  // ============================================================
  // STEP 2: ASSIGN YAZANAKI EMPIRE ROLES
  // ============================================================
  const yazanakiRoles = await assignYazanakiRoles(client, discordId, clanGuildId);
  
  if (!yazanakiRoles.success) {
    console.error(`[acceptedapps] ❌ Failed to assign Yazanaki roles: ${yazanakiRoles.reason}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: yazanakiRoles.reason };
  }

  const clan = yazanakiRoles.clan;

  // ============================================================
  // STEP 3: ASSIGN CLAN DISCORD ROLE (optional)
  // ============================================================
  await assignClanRole(client, discordId, clanGuildId, clan);

  // ============================================================
  // STEP 4: ASSIGN EMPIRE ID
  // ============================================================
  console.log(`[acceptedapps] 🆔 STEP 4: Assigning Empire ID...`);
  const empireIdResult = assignEmpireId(discordId, minecraftUser, clanGuildId);
  
  let empireId = "PENDING";
  
  if (empireIdResult.success) {
    empireId = empireIdResult.empireId;
    
    if (empireIdResult.isReturning) {
      console.log(`[acceptedapps] ♻️ RETURNING: ${empireId}`);
    } else {
      console.log(`[acceptedapps] ✨ NEW: ${empireId}`);
    }
  } else {
    console.error(`[acceptedapps] ❌ Empire ID failed: ${empireIdResult.reason}`);
  }

  // ============================================================
  // STEP 5: CREATE COMPLETE MEMBER ENTRY WITH DRAFT FIELDS
  // ============================================================
  console.log(`[acceptedapps] 📝 STEP 5: Creating member entry with draft fields...`);
  
  const closeDate = formatDate(new Date().toISOString());
  const now = new Date();
  const draftDuration = config.getDraftDuration();
  const expiryDate = new Date(now.getTime() + draftDuration);
  
  // ✅ CREATE MEMBER ENTRY WITH ALL FIELDS INCLUDING DRAFT
  members[discordId] = {
    discordId,
    discordUser,
    minecraftUser,
    minecraftVersion,
    JoinedClan: clan.name,
    JoinDate: closeDate,
    YazanakiRank: "Recruit",
    EmpireID: empireId,
    Status: "Military",
    points: 0,
    // ✅ DRAFT FIELDS - Initialize them here!
    draftStartDate: now.toISOString(),
    draftExpiryDate: expiryDate.toISOString(),
    draftReminderSent: false,
    draftNotified: false
  };
  
  // Save the complete member entry
  writeMembers(members);

  // ✅ Slot the newly-accepted recruit into the military chain of command,
  // under the Imperial Army soldier tied to whoever invited them. Best-effort:
  // squadron issues must never block acceptance.
  try {
    require("../yazanaki/squadronlogic").resolveRecruitPlacement(discordId);
  } catch (err) {
    console.warn(`[acceptedapps] ⚠️ Squadron recruit placement failed:`, err.message);
  }

  const mode = config.TESTING_MODE ? "TESTING" : "PRODUCTION";
  const duration = config.TESTING_MODE 
    ? `${config.DRAFT_DURATION_MINUTES} minutes`
    : `${config.DRAFT_DURATION_DAYS} days`;
  
  console.log(`[acceptedapps] ✅ Member entry created with draft fields`);
  console.log(`[acceptedapps] 🎖️ Draft Mode: ${mode}`);
  console.log(`[acceptedapps] ⏰ Draft Duration: ${duration}`);
  console.log(`[acceptedapps] 📅 Draft Expiry: ${expiryDate.toISOString()}`);

  // ============================================================
  // ✅ NEW: STEP 6: INCREMENT CLAN RESIDENT COUNT
  // ============================================================
  console.log(`[acceptedapps] 📊 STEP 6: Incrementing clan resident count...`);
  const residentIncremented = incrementClanResidents(clanGuildId);
  
  if (residentIncremented) {
    console.log(`[acceptedapps] ✅ Clan ${clan.abbr} resident count updated`);

    // ✅ NEW: Issue 1000 more treasury shares for the clan's stock (no-op if
    // the clan has never run /stock post or isn't linked to a server yet —
    // the record is created/reconciled lazily whenever it's next accessed).
    try {
      onStockResidentAdded(clanGuildId);
    } catch (err) {
      console.warn(`[acceptedapps] ⚠️ Failed to update stock treasury for ${clan.abbr}:`, err.message);
    }
  } else {
    console.warn(`[acceptedapps] ⚠️ Failed to increment resident count for ${clan.abbr}`);
  }

  console.log(`[acceptedapps] ✅ SUCCESS!`);
  console.log(`[acceptedapps] 🆔 Empire ID: ${empireId}`);
  console.log(`[acceptedapps] 🏷️ Clan: ${clan.abbr}`);
  console.log(`[acceptedapps] 🎭 Roles: Military, Recruit, ${clan.abbr}`);
  console.log(`[acceptedapps] 🎖️ Draft: Active until ${expiryDate.toLocaleString()}`);
  console.log(`[acceptedapps] 📅 Join Date: ${closeDate} (LOCKED)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success: true, empireId, clan, joinDate: closeDate };
};

// Exported for reuse by the onboarding flow's "I've joined" gate.
module.exports.checkInYazanaki = checkInYazanaki;
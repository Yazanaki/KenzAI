// modules/discord/setup/clanAlliance.js
// Bridges the /setup Clan and Alliance panels to the existing clan/alliance
// systems, so setup is "another way to use /clan edit / /alliance edit" rather
// than a separate config. Resolves the record for the CURRENT guild and edits
// it through the same clanlogic/alliancelogic used by the /clan and /alliance
// commands. Edits are gated by the same Royalty role check those commands use.

const fs = require("fs");
const clanlogic = require("../../clantracking/clanlogic");
const alliancelogic = require("../../alliances/alliancelogic");
const draftConfig = require("../../empire/draftconfig");
const { loadRolesConfig } = require("../../roles/roledetector");

const FALLBACK_ROYALTY_ROLE_ID = "1334642034472128654";

/** Same Royalty gate the /clan and /alliance commands enforce. */
async function isRoyalty(client, userId) {
  try {
    const guild = await client.guilds.fetch(draftConfig.YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
    if (!guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    let royaltyId = null;
    const cfg = loadRolesConfig()?.guilds?.[draftConfig.YAZANAKI_EMPIRE_GUILD_ID];
    if (cfg?.statusRoles) {
      const entry = Object.entries(cfg.statusRoles).find(([, d]) => d?.name === "Royalty");
      if (entry) royaltyId = entry[0];
    }
    return member.roles.cache.has(royaltyId || FALLBACK_ROYALTY_ROLE_ID);
  } catch {
    return false;
  }
}

function getClanForGuild(guildId) {
  return clanlogic.readClans()[guildId] || null;
}

function getAllianceForGuild(guildId) {
  return Object.values(alliancelogic.readAlliances()).find((a) => a && a.clanGuildId === guildId) || null;
}

/**
 * Apply modal-friendly edits to the current guild's clan (mirrors /clan edit).
 * @returns {{ ok: boolean, changes?: string[], reason?: string }}
 */
function applyClanEdit(guildId, { name, abbreviation, applicationMode, server }) {
  const clans = clanlogic.readClans();
  const clan = clans[guildId];
  if (!clan) return { ok: false, reason: "This server isn't a registered clan." };
  const changes = [];

  if (abbreviation && abbreviation.toUpperCase() !== clan.abbr.toUpperCase()) {
    const oldAbbr = clan.abbr;
    clan.abbr = abbreviation.toUpperCase();
    changes.push(`Abbreviation → ${clan.abbr}`);
    try {
      const oldPath = clanlogic.getFlagPath(oldAbbr);
      if (fs.existsSync(oldPath)) fs.renameSync(oldPath, clanlogic.getFlagPath(clan.abbr));
    } catch {
      /* flag move best-effort */
    }
  }
  if (name && name !== clan.name) {
    clan.name = name;
    changes.push(`Name → ${clan.name}`);
  }
  if (applicationMode && ["manual", "automatic"].includes(applicationMode) && applicationMode !== (clan.applicationMode || "manual")) {
    clan.applicationMode = applicationMode;
    changes.push(`Application mode → ${applicationMode}`);
  }
  if (server != null) {
    const v = server.trim().toLowerCase();
    if (v === "" || v === "clear") {
      if (clan.donutsmpTeamName) changes.push("Cleared DonutSMP link");
      delete clan.donutsmpTeamName;
    } else if (v === "donutsmp") {
      clan.donutsmpTeamName = clan.abbr;
      changes.push(`Linked to DonutSMP (team ${clan.abbr})`);
    }
  }

  if (!changes.length) return { ok: false, reason: "No changes provided." };
  clanlogic.writeClans(clans);
  return { ok: true, changes };
}

/** Set the current guild's clan-side member role (mirrors /clan edit clanrole). */
function setClanRole(guildId, roleId) {
  const clans = clanlogic.readClans();
  const clan = clans[guildId];
  if (!clan) return { ok: false, reason: "This server isn't a registered clan." };
  clan.clanRoleId = roleId || null;
  clanlogic.writeClans(clans);
  return { ok: true };
}

/** Edit the current guild's alliance invite (mirrors /alliance join update). */
function applyAllianceEdit(guildId, { invite }) {
  const alliances = alliancelogic.readAlliances();
  const entry = Object.entries(alliances).find(([, a]) => a && a.clanGuildId === guildId);
  if (!entry) return { ok: false, reason: "This server's clan isn't part of an alliance." };
  const [, alli] = entry;
  if (invite != null) alli.invite = invite.trim() || null;
  alliancelogic.writeAlliances(alliances);
  return { ok: true };
}

module.exports = { isRoyalty, getClanForGuild, getAllianceForGuild, applyClanEdit, setClanRole, applyAllianceEdit };

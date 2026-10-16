// modules/database/stores.js
// Central registry of every "extra" JSON store that is dual-written to MySQL.
//
// The core member-facing tables (members, clans, empire_ids) keep their bespoke
// flat repositories (the API + Mod query them). Everything else uses the generic
// hybrid MapStore: a `data` JSON column holds the full object losslessly (so the
// bot always reads back exactly what it stored), while a handful of indexed
// columns are derived for SQL analytics (stats module, future API endpoints).

const path = require("path");
const { MapStore } = require("./mapStore");

const dataDir = path.join(__dirname, "..", "data");
const dataPath = (file) => path.join(dataDir, file);

// Judiciary keeps its own data dir (cases / archived cases / audit log).
const judiciaryDir = path.join(__dirname, "..", "judiciary", "data");
const judiciaryPath = (file) => path.join(judiciaryDir, file);

// ---- value coercion helpers (JSON value -> SQL column) --------------------

/** ISO / Date-ish value -> MySQL DATETIME string ("YYYY-MM-DD HH:MM:SS") or null. */
function dt(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}
/** truthy -> 1, else 0. */
function bool(v) {
  return v ? 1 : 0;
}
/** value -> trimmed string or null. */
function str(v) {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s.length ? s : null;
}
/** number-ish -> Number or default. */
function int(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

/**
 * Build a hybrid mapper: full object in `data` JSON (lossless read-back) plus
 * derived analytics columns.
 * @param {string}   pkCol   primary-key column name
 * @param {Function} [index] (id, value) => ({ col: val }) analytics columns
 */
function hybrid(pkCol, index) {
  return {
    pk: pkCol,
    toRow(id, value) {
      const row = { [pkCol]: String(id) };
      if (index) Object.assign(row, index(id, value || {}) || {});
      row.data = JSON.stringify(value == null ? {} : value);
      return row;
    },
    fromRow(row) {
      try {
        const raw = row.data;
        if (raw == null) return {};
        return typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return {};
      }
    },
  };
}

function defineStore(name, jsonFile, table, pkCol, index, extra = {}) {
  const m = hybrid(pkCol, index);
  return new MapStore({
    name,
    jsonPath: dataPath(jsonFile),
    table,
    pk: m.pk,
    toRow: m.toRow,
    fromRow: m.fromRow,
    ...extra,
  });
}

// ---- store definitions -----------------------------------------------------

const stores = {
  // Applications (ALL applications; accepted ones are copied into `members`).
  applicants: defineStore(
    "applicants",
    "applicants.json",
    "applicants",
    "discord_id",
    (id, v) => ({
      discord_user: str(v.discordUser),
      minecraft_user: str(v.minecraftUser),
      minecraft_user_key: str(v.minecraftUserKey || (v.minecraftUser ? String(v.minecraftUser).toLowerCase() : null)),
      server_guild_id: str(v.server),
      accepted: bool(v.accepted),
      opened_at: dt(v.openedAt),
      closed_at: dt(v.closedAt),
    })
  ),

  // Kicked members (3-month reapply cooldown).
  kicked_members: defineStore(
    "kicked_members",
    "kicked_members.json",
    "kicked_members",
    "discord_id",
    (id, v) => ({
      empire_id: str(v.empireId),
      discord_user: str(v.discordUser),
      minecraft_user: str(v.minecraftUser),
      original_clan: str(v.originalClan),
      kicked_at: dt(v.kickedAt),
      can_reapply_at: dt(v.canReapplyAt),
    })
  ),

  // Permanently banned members.
  banned_members: defineStore(
    "banned_members",
    "banned_members.json",
    "banned_members",
    "discord_id",
    (id, v) => ({
      empire_id: str(v.empireId),
      discord_user: str(v.discordUser),
      minecraft_user: str(v.minecraftUser),
      original_clan: str(v.originalClan),
      banned_at: dt(v.bannedAt),
    })
  ),

  // Account linking (main + alternate Minecraft accounts).
  linking: defineStore(
    "linking",
    "linking.json",
    "linking",
    "discord_id",
    (id, v) => ({
      main_account: str(v.main || v.minecraftUser),
    })
  ),

  // Bot-slot monetization: subscriptions.
  subscriptions: defineStore(
    "subscriptions",
    "subscriptions.json",
    "subscriptions",
    "user_id",
    (id, v) => ({
      tier: str(v.subscription_tier),
      active: bool(v.active),
      max_slots_allowed: int(v.max_slots_allowed, 0),
    })
  ),

  subscription_logs: defineStore(
    "subscription_logs",
    "subscription_logs.json",
    "subscription_logs",
    "log_id",
    (id, v) => ({
      user_id: str(v.user_id),
      action: str(v.action),
      tier: str(v.tier),
      logged_at: dt(v.timestamp),
    })
  ),

  bot_slots: defineStore(
    "bot_slots",
    "bot_slots.json",
    "bot_slots",
    "slot_id",
    (id, v) => ({
      owner_id: str(v.owner_id),
      mc_username: str(v.mc_username),
      tier: str(v.tier),
      server_id: str(v.server_id),
    })
  ),

  slot_queue: defineStore(
    "slot_queue",
    "slot_queue.json",
    "slot_queue",
    "queue_id",
    (id, v) => ({
      user_id: str(v.user_id),
      tier: str(v.tier),
      queued_at: dt(v.queued_at),
    })
  ),

  // Game-server registry (config). Note: servers.json also holds a top-level
  // "statEmojis" key which round-trips losslessly via the data column.
  servers: defineStore(
    "servers",
    "servers.json",
    "servers",
    "server_id",
    (id, v) => ({
      name: str(v && v.name),
      enabled: bool(!v || v.enabled !== false),
    })
  ),

  // Members who left / were archived (draft desertion etc.).
  archived_members: defineStore(
    "archived_members",
    "archived_members.json",
    "archived_members",
    "discord_id",
    (id, v) => ({
      empire_id: str(v.empireId),
      minecraft_user: str(v.minecraftUser),
      original_clan: str(v.originalClan),
      left_at: dt(v.leftDate || v.archivedAt),
    })
  ),

  draft_deserters: defineStore(
    "draft_deserters",
    "draft_deserters.json",
    "draft_deserters",
    "discord_id",
    (id, v) => ({
      empire_id: str(v.empireId),
      minecraft_user: str(v.minecraftUser),
      original_clan: str(v.originalClan),
      deserted_at: dt(v.desertedAt),
      punishment_served: bool(v.punishmentServed),
    })
  ),

  // Judiciary court requests.
  court_requests: defineStore(
    "court_requests",
    "court_requests.json",
    "court_requests",
    "discord_id",
    (id, v) => ({
      accused_minecraft: str(v.accusedMinecraft),
      crime_type: str(v.crimeType),
      ticket_channel: str(v.ticketChannel),
      ticket_number: v.ticketNumber == null ? null : int(v.ticketNumber, null),
      opened_at: dt(v.openedAt),
      escalated: bool(v.escalated),
      dismissed: bool(v.dismissed),
    })
  ),

  // Per-guild role-detection config. roles.json is { guilds: { [gid]: cfg } }.
  roles_config: defineStore(
    "roles_config",
    "roles.json",
    "roles_config",
    "guild_id",
    (id, v) => ({ name: str(v && v.name) }),
    {
      unwrap: (obj) => (obj && typeof obj.guilds === "object" ? obj.guilds : {}),
      wrap: (map) => ({ guilds: map || {} }),
      defaults: () => ({
        guilds: {
          "1220847061797179524": { name: "Yazanaki Empire", statusRoles: {}, rankRoles: {} },
        },
      }),
    }
  ),

  // Channel config singleton — stored as a single row keyed "channels".
  channels_config: defineStore(
    "channels_config",
    "channels.json",
    "channels_config",
    "config_key",
    null,
    {
      unwrap: (obj) => ({ channels: obj && typeof obj === "object" ? obj : {} }),
      wrap: (map) => (map && map.channels ? map.channels : {}),
      defaults: () => ({
        points: { staffChannelId: null, messageChannelIds: [] },
        applications: { categoryName: "applications" },
      }),
    }
  ),

  // Judiciary case lifecycle (separate judiciary/data dir).
  judiciary_cases: defineStore(
    "judiciary_cases",
    "cases.json",
    "judiciary_cases",
    "case_id",
    null,
    { jsonPath: judiciaryPath("cases.json") }
  ),

  judiciary_archived_cases: defineStore(
    "judiciary_archived_cases",
    "archived_cases.json",
    "judiciary_archived_cases",
    "case_id",
    null,
    { jsonPath: judiciaryPath("archived_cases.json") }
  ),

  // Clan stock market — one record per clan guild ID.
  clan_stocks: defineStore(
    "clan_stocks",
    "clan_stocks.json",
    "clan_stocks",
    "guild_id",
    (id, v) => ({
      server_id: str(v.server),
      current_price: int(v.currentPrice, 0),
      treasury_shares: int(v.treasuryShares, 0),
      outstanding_shares: int(v.outstandingShares, 0),
    })
  ),

  // Stock holdings — keyed by "<guildId>:<discordId>".
  stock_holdings: defineStore(
    "stock_holdings",
    "stock_holdings.json",
    "stock_holdings",
    "holding_id",
    (id, v) => ({
      guild_id: str(v.guildId),
      discord_id: str(v.discordId),
      shares: int(v.shares, 0),
    })
  ),

  // Stock transaction ledger — keyed by generated txId, append-only.
  stock_transactions: defineStore(
    "stock_transactions",
    "stock_transactions.json",
    "stock_transactions",
    "tx_id",
    (id, v) => ({
      guild_id: str(v.guildId),
      discord_id: str(v.discordId),
      tx_type: str(v.type),
      shares: int(v.shares, 0),
      logged_at: dt(v.createdAt),
    })
  ),

  // Durable pending sell payouts awaiting owner "Mark Paid" confirmation.
  stock_pending_sells: defineStore(
    "stock_pending_sells",
    "stock_pending_sells.json",
    "stock_pending_sells",
    "tx_id",
    (id, v) => ({
      guild_id: str(v.guildId),
      discord_id: str(v.discordId),
      shares: int(v.shares, 0),
      status: str(v.status),
    })
  ),

  // Military chain-of-command trees — one record per High General's tree.
  // The officer skeleton lives in data.nodes; recruits are resolved, not stored.
  military_squadrons: defineStore(
    "military_squadrons",
    "military_squadrons.json",
    "military_squadrons",
    "squadron_id",
    (id, v) => ({
      guild_id: str(v.guildId),
      name: str(v.name),
      high_general_id: str(v.highGeneralId),
    })
  ),

  // Recruit invite attribution — keyed by the invited member's Discord ID.
  // inviterId captured at join; soldierId/treeId are the resolved placement.
  military_invites: defineStore(
    "military_invites",
    "military_invites.json",
    "military_invites",
    "discord_id",
    (id, v) => ({
      inviter_id: str(v.inviterId),
      soldier_id: str(v.soldierId),
    })
  ),

  // audit_log.json is a JSON ARRAY — adapt array <-> map (keyed by log_id).
  judiciary_audit_log: defineStore(
    "judiciary_audit_log",
    "audit_log.json",
    "judiciary_audit_log",
    "log_id",
    (id, v) => ({
      case_id: str(v.case_id),
      action: str(v.action),
      logged_at: dt(v.timestamp),
    }),
    {
      jsonPath: judiciaryPath("audit_log.json"),
      defaults: () => [],
      unwrap: (arr) => {
        const map = {};
        (Array.isArray(arr) ? arr : []).forEach((e, i) => {
          const key = e && e.log_id ? String(e.log_id) : `idx-${i}`;
          map[key] = e;
        });
        return map;
      },
      wrap: (map) =>
        Object.values(map || {}).sort(
          (a, b) => new Date(a && a.timestamp || 0) - new Date(b && b.timestamp || 0)
        ),
    }
  ),

  // ===== Discord module (moderation, leveling, giveaways, invites, stats) =====

  // Per-guild config for every discord-module feature (one row per guild).
  discord_settings: defineStore(
    "discord_settings",
    "discord_settings.json",
    "discord_settings",
    "guild_id",
    null
  ),

  // Moderation infractions — keyed by generated case id.
  discord_infractions: defineStore(
    "discord_infractions",
    "discord_infractions.json",
    "discord_infractions",
    "case_id",
    (id, v) => ({
      guild_id: str(v.guildId),
      user_id: str(v.userId),
      moderator_id: str(v.moderatorId),
      action: str(v.action),
      active: bool(v.active !== false),
      logged_at: dt(v.createdAt),
    })
  ),

  // Leveling XP (message + voice) — keyed by "<guildId>:<userId>".
  discord_levels: defineStore(
    "discord_levels",
    "discord_levels.json",
    "discord_levels",
    "member_key",
    (id, v) => ({
      guild_id: str(v.guildId),
      user_id: str(v.userId),
      xp: int(v.xp, 0),
      level: int(v.level, 0),
      messages: int(v.messages, 0),
      voice_seconds: int(v.voiceSeconds, 0),
    })
  ),

  // Giveaways — keyed by the giveaway message id.
  discord_giveaways: defineStore(
    "discord_giveaways",
    "discord_giveaways.json",
    "discord_giveaways",
    "message_id",
    (id, v) => ({
      guild_id: str(v.guildId),
      channel_id: str(v.channelId),
      status: str(v.status),
      ends_at: dt(v.endsAt),
    })
  ),

  // Reusable giveaway templates — keyed by "<guildId>:<name>".
  discord_giveaway_templates: defineStore(
    "discord_giveaway_templates",
    "discord_giveaway_templates.json",
    "discord_giveaway_templates",
    "template_key",
    (id, v) => ({
      guild_id: str(v.guildId),
      name: str(v.name),
    })
  ),

  // Per-user invite attribution + counts — keyed by "<guildId>:<userId>".
  discord_invites: defineStore(
    "discord_invites",
    "discord_invites.json",
    "discord_invites",
    "member_key",
    (id, v) => ({
      guild_id: str(v.guildId),
      user_id: str(v.userId),
      regular: int(v.regular, 0),
      fake: int(v.fake, 0),
      left_count: int(v.left, 0),
      bonus: int(v.bonus, 0),
    })
  ),

  // Per-guild statistics counters (totals + daily buckets in `data`).
  discord_stats: defineStore(
    "discord_stats",
    "discord_stats.json",
    "discord_stats",
    "guild_id",
    (id, v) => ({
      joins: int(v.joins, 0),
      leaves: int(v.leaves, 0),
      messages: int(v.messages, 0),
      voice_seconds: int(v.voiceSeconds, 0),
    })
  ),

  // Booster self-service roles — keyed by "<guildId>:<userId>".
  discord_booster_roles: defineStore(
    "discord_booster_roles",
    "discord_booster_roles.json",
    "discord_booster_roles",
    "member_key",
    (id, v) => ({
      guild_id: str(v.guildId),
      user_id: str(v.userId),
      role_id: str(v.roleId),
    })
  ),

  // Per-member boost counts (for the multi-booster role).
  discord_boost_counts: defineStore(
    "discord_boost_counts",
    "discord_boost_counts.json",
    "discord_boost_counts",
    "member_key",
    (id, v) => ({
      guild_id: str(v.guildId),
      user_id: str(v.userId),
      count: int(v.count, 0),
    })
  ),

  // Recurring giveaway schedules — keyed by generated schedule id.
  discord_giveaway_schedules: defineStore(
    "discord_giveaway_schedules",
    "discord_giveaway_schedules.json",
    "discord_giveaway_schedules",
    "schedule_id",
    (id, v) => ({
      guild_id: str(v.guildId),
      channel_id: str(v.channelId),
      template_name: str(v.templateName),
      enabled: bool(v.enabled !== false),
      next_run_at: dt(v.nextRunAt),
    })
  ),
};

module.exports = { stores };

// modules/discord/discordconfig.js
// Central constants + per-guild default settings for the all-in-one Discord
// module (moderation/automod, leveling, giveaways, invite tracking, stats).
//
// This module is config-driven and guild-agnostic: nothing here hardcodes a
// specific server. All runtime configuration lives per-guild in the
// `discord_settings` store (see settings/settingsStore.js); the shape below is
// the default that a guild starts from and is deep-merged under any overrides.
//
// Optional env overrides (all have safe defaults — the module works with none):
//   DISCORD_GIVEAWAY_TICK_SECONDS   giveaway auto-end poll interval (default 30)
//   DISCORD_VOICE_TICK_SECONDS      voice-XP accrual flush interval (default 60)

const EMBED_COLORS = {
  brand: 0x5865f2,
  success: 0x57f287,
  warn: 0xfee75c,
  danger: 0xed4245,
  info: 0x5865f2,
  neutral: 0x2b2d31,
};

// customId prefixes routed in events/interactionCreate.js.
const IDS = {
  giveaway: "dgw_", // giveaway entry button / management
  moderation: "dmod_",
  leveling: "dlvl_",
  invites: "dinv_",
  settings: "dset_", // /setup dashboard components
  boosters: "dbr_", // booster self-service role components
};

const DEFAULT_SETTINGS = {
  moderation: {
    modLogChannelId: null, // fallback log channel for any action without a specific one
    dmOnAction: true, // DM the target when they are warned/muted/kicked/banned
    // Per-action log channels (fall back to modLogChannelId when null).
    logs: {
      ban: null,
      softban: null,
      unban: null,
      kick: null,
      mute: null,
      unmute: null,
      warn: null,
      purge: null,
    },
  },
  // Command-permission "moderation roles": role groups + which group may run
  // each command. Members with Manage Server / Administrator always pass. If a
  // command maps to a group that has NO roles configured, it falls back to the
  // command's built-in Discord permission check.
  permissions: {
    groups: {
      moderator: [], // [roleId]
      admin: [],
      giveawayHost: [],
    },
    commandGroup: {
      warn: "moderator",
      mute: "moderator",
      unmute: "moderator",
      kick: "moderator",
      purge: "moderator",
      slowmode: "moderator",
      lock: "moderator",
      unlock: "moderator",
      infractions: "moderator",
      ban: "admin",
      softban: "admin",
      unban: "admin",
      giveaway: "giveawayHost",
    },
  },
  // Booster self-service roles.
  boosterRoles: {
    enabled: false,
    requireBoost: true, // only current boosters may create/keep a personal role
    anchorRoleId: null, // new roles placed just below this role (else below bot top)
    removeOnUnboost: true, // delete the role when the member stops boosting
    allowGradient: true, // use a 2nd hex when the guild has ENHANCED_ROLE_COLORS
    allowIcons: true, // set emoji/icon when the guild has ROLE_ICONS
    logChannelId: null,
    // Multi-booster role: granted to members who have boosted this server
    // >= multiBoostThreshold times. Discord exposes no per-member boost count,
    // so counts are tracked from GuildBoost system messages seen while the bot
    // is running (admins can seed with /boostrole setcount). Per-server role.
    multiBoostRoleId: null,
    multiBoostThreshold: 2,
  },
  automod: {
    enabled: false,
    logChannelId: null,
    exemptRoleIds: [], // roles immune to automod
    exemptChannelIds: [],
    antiInvite: { enabled: false, action: "delete" }, // delete | warn | mute
    antiSpam: {
      enabled: false,
      maxMessages: 5,
      intervalMs: 5000,
      action: "mute", // delete | warn | mute
      muteSeconds: 300,
    },
    antiMention: {
      enabled: false,
      maxMentions: 5,
      action: "mute",
      muteSeconds: 600,
    },
    antiCaps: { enabled: false, minLength: 10, percent: 70, action: "delete" },
    wordFilter: { enabled: false, words: [], action: "delete" },
    antiRaid: {
      enabled: false,
      joinCount: 10, // this many joins...
      intervalMs: 10000, // ...within this window triggers a raid alert/lockdown
      action: "alert", // alert | kick | ban
    },
  },
  leveling: {
    enabled: false,
    xpPerMessageMin: 15,
    xpPerMessageMax: 25,
    messageCooldownSeconds: 60,
    voiceXpPerMinute: 5,
    countAfkChannel: false,
    countMutedVoice: false,
    announceLevelUp: true,
    // Where to announce: "current" (same channel), "dm", or a channel id.
    announceTarget: "current",
    levelUpMessage: "GG {user}, you just reached level **{level}**! 🎉",
    noXpChannelIds: [],
    noXpRoleIds: [],
    stackRewards: true, // keep lower reward roles when a higher one is earned
    roleRewards: {}, // { "5": "<roleId>", "10": "<roleId>" }
    multiplierRoles: {}, // { "<roleId>": 2 }  (XP multiplier while holding role)
  },
  giveaways: {
    hostRoleIds: [], // may run /giveaway in addition to Manage Server perm
    emoji: "🎉",
    // Bonus entries are configured per-giveaway (/giveaway create bonus-role)
    // and per-template (/giveaway template bonus), not server-wide.
  },
  invites: {
    enabled: false,
    fakeAccountAgeDays: 7, // joiner account younger than this counts as "fake"
    joinLogChannelId: null, // posts "X joined — invited by Y (N invites)"
    rewards: {}, // { "10": "<roleId>" }  role granted at N real invites
  },
  statistics: {
    enabled: false,
    logs: {
      joinLeaveChannelId: null,
      messageChannelId: null, // deleted / edited message logs
      voiceChannelId: null, // voice join/leave/move logs
    },
  },
};

module.exports = { EMBED_COLORS, IDS, DEFAULT_SETTINGS };

-- ============================================================
-- 005_discord.sql — All-in-one Discord module (Phase 1)
--
-- Backs the general-purpose Discord feature suite in modules/discord/:
-- moderation + automod, leveling (message + voice XP), giveaways,
-- invite tracking, and server statistics/logging.
--
-- Every table follows the generic MapStore hybrid shape used by
-- modules/database/stores.js: a `data` JSON column holds the full object
-- losslessly (the bot always reads back exactly what it stored), plus a
-- handful of indexed columns derived for SQL analytics. The JSON files in
-- modules/data/ stay the primary read path; MySQL is an opt-in dual-write
-- mirror (see modules/database/dbConfig.js). No external API depends on
-- these tables, so re-running this migration against live data is safe.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Per-guild configuration for every discord-module feature (one row/guild).
CREATE TABLE IF NOT EXISTS discord_settings (
    guild_id    VARCHAR(20) NOT NULL,
    data        JSON NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Moderation infractions (warn/mute/kick/ban/...), keyed by generated case id.
CREATE TABLE IF NOT EXISTS discord_infractions (
    case_id      VARCHAR(60) NOT NULL,
    guild_id     VARCHAR(20) NOT NULL,
    user_id      VARCHAR(20) NULL,
    moderator_id VARCHAR(20) NULL,
    action       VARCHAR(20) NULL,
    active        TINYINT(1) NOT NULL DEFAULT 1,
    data         JSON NULL,
    logged_at    DATETIME NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (case_id),
    INDEX idx_discord_infractions_guild (guild_id),
    INDEX idx_discord_infractions_user  (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Leveling XP (message + voice), keyed by "<guildId>:<userId>".
CREATE TABLE IF NOT EXISTS discord_levels (
    member_key    VARCHAR(45) NOT NULL,
    guild_id      VARCHAR(20) NOT NULL,
    user_id       VARCHAR(20) NOT NULL,
    xp            BIGINT UNSIGNED NOT NULL DEFAULT 0,
    level         INT UNSIGNED NOT NULL DEFAULT 0,
    messages      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    voice_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data          JSON NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (member_key),
    INDEX idx_discord_levels_guild (guild_id),
    INDEX idx_discord_levels_xp    (guild_id, xp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Giveaways, keyed by the giveaway message id.
CREATE TABLE IF NOT EXISTS discord_giveaways (
    message_id  VARCHAR(20) NOT NULL,
    guild_id    VARCHAR(20) NOT NULL,
    channel_id  VARCHAR(20) NULL,
    status      VARCHAR(20) NULL,
    ends_at     DATETIME NULL,
    data        JSON NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id),
    INDEX idx_discord_giveaways_guild  (guild_id),
    INDEX idx_discord_giveaways_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Reusable giveaway templates, keyed by "<guildId>:<name>".
CREATE TABLE IF NOT EXISTS discord_giveaway_templates (
    template_key VARCHAR(120) NOT NULL,
    guild_id     VARCHAR(20) NOT NULL,
    name         VARCHAR(80) NULL,
    data         JSON NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (template_key),
    INDEX idx_discord_gw_templates_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-user invite attribution + counts, keyed by "<guildId>:<userId>".
CREATE TABLE IF NOT EXISTS discord_invites (
    member_key VARCHAR(45) NOT NULL,
    guild_id   VARCHAR(20) NOT NULL,
    user_id    VARCHAR(20) NOT NULL,
    regular    INT NOT NULL DEFAULT 0,
    fake       INT NOT NULL DEFAULT 0,
    left_count INT NOT NULL DEFAULT 0,
    bonus      INT NOT NULL DEFAULT 0,
    data       JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (member_key),
    INDEX idx_discord_invites_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-guild statistics counters (totals + rolling daily buckets in `data`).
CREATE TABLE IF NOT EXISTS discord_stats (
    guild_id      VARCHAR(20) NOT NULL,
    joins         BIGINT UNSIGNED NOT NULL DEFAULT 0,
    leaves        BIGINT UNSIGNED NOT NULL DEFAULT 0,
    messages      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    voice_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data          JSON NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

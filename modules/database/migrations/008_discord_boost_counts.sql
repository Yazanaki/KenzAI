-- ============================================================
-- 008_discord_boost_counts.sql — Per-member boost counts
--
-- Discord does not expose how many times an individual member has boosted, so
-- this tracks counts observed from GuildBoost (type 8) system messages while
-- the bot runs (admins can seed via /boostrole setcount). Used to grant a
-- per-server "multi-booster" role. Generic MapStore hybrid shape.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS discord_boost_counts (
    member_key VARCHAR(45) NOT NULL,   -- "<guildId>:<userId>"
    guild_id   VARCHAR(20) NOT NULL,
    user_id    VARCHAR(20) NOT NULL,
    count      INT NOT NULL DEFAULT 0,
    data       JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (member_key),
    INDEX idx_discord_boost_counts_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

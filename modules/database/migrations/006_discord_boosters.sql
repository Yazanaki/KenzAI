-- ============================================================
-- 006_discord_boosters.sql — Booster self-service roles
--
-- One custom role per booster per guild, created via /boostrole. Follows the
-- generic MapStore hybrid shape (lossless `data` JSON + indexed columns). JSON
-- file stays the primary read path; MySQL is an opt-in mirror.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS discord_booster_roles (
    member_key VARCHAR(45) NOT NULL,   -- "<guildId>:<userId>"
    guild_id   VARCHAR(20) NOT NULL,
    user_id    VARCHAR(20) NOT NULL,
    role_id    VARCHAR(20) NULL,
    data       JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (member_key),
    INDEX idx_discord_booster_roles_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

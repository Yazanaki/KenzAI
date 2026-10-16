-- ============================================================
-- 007_discord_giveaway_schedules.sql — Recurring giveaways
--
-- A recurring schedule launches a fresh giveaway from a saved template on a
-- fixed interval. Generic MapStore hybrid shape (lossless `data` JSON + indexed
-- columns). JSON file is the primary read path; MySQL is an opt-in mirror.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS discord_giveaway_schedules (
    schedule_id   VARCHAR(60) NOT NULL,
    guild_id      VARCHAR(20) NOT NULL,
    channel_id    VARCHAR(20) NULL,
    template_name VARCHAR(80) NULL,
    enabled       TINYINT(1) NOT NULL DEFAULT 1,
    next_run_at   DATETIME NULL,
    data          JSON NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (schedule_id),
    INDEX idx_discord_gw_schedules_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

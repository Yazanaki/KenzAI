-- ============================================================
-- 005: Yazanaki Client (launcher) sign-in.
-- Owned by YazanakiAPI (/auth/* routes); lives here because KenzAI runs the
-- schema migrations for the shared database.
-- ============================================================

-- One row per sign-in attempt. The 6-digit code is never stored: only
-- sha256(challenge_id + ':' + code). KenzAI DMs the code and forgets it.
CREATE TABLE IF NOT EXISTS launcher_login_challenges (
    challenge_id CHAR(32)     NOT NULL,
    empire_id    VARCHAR(20)  NOT NULL,
    discord_id   VARCHAR(20)  NOT NULL,
    code_hash    CHAR(64)     NOT NULL,
    attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,
    request_ip   VARCHAR(45),
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at   DATETIME     NOT NULL,
    consumed_at  DATETIME,
    PRIMARY KEY (challenge_id),
    INDEX idx_llc_empire (empire_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per signed-in launcher install. Only the token's sha256 is stored.
-- Setting revoked_at (or deactivating the member) signs that device out.
CREATE TABLE IF NOT EXISTS launcher_devices (
    token_hash   CHAR(64)     NOT NULL,
    empire_id    VARCHAR(20)  NOT NULL,
    discord_id   VARCHAR(20)  NOT NULL,
    device_name  VARCHAR(100),
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME,
    revoked_at   DATETIME,
    PRIMARY KEY (token_hash),
    INDEX idx_ld_empire (empire_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

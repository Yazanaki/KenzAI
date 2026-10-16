// auth/schema.js
// Creates the launcher sign-in tables on startup, so no manual migration step
// is needed (the API often runs on a panel without a shell). Same definitions
// as KenzAI's 005_launcher_auth.sql; IF NOT EXISTS makes either order safe.

const TABLES = [
    `CREATE TABLE IF NOT EXISTS launcher_login_challenges (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS launcher_devices (
        token_hash   CHAR(64)     NOT NULL,
        empire_id    VARCHAR(20)  NOT NULL,
        discord_id   VARCHAR(20)  NOT NULL,
        device_name  VARCHAR(100),
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME,
        revoked_at   DATETIME,
        PRIMARY KEY (token_hash),
        INDEX idx_ld_empire (empire_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function ensureAuthTables(db) {
    for (const sql of TABLES) await db.query(sql);
}

module.exports = { ensureAuthTables };

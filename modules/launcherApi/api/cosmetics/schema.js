// cosmetics/schema.js
// Client cosmetics tables, created on startup like auth/schema.js.

const TABLES = [
    `CREATE TABLE IF NOT EXISTS cosmetic_players (
        uuid          CHAR(32)     NOT NULL,
        name          VARCHAR(16)  NOT NULL,
        first_seen_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at  DATETIME,
        PRIMARY KEY (uuid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS cosmetic_sessions (
        token_hash   CHAR(64)     NOT NULL,
        uuid         CHAR(32)     NOT NULL,
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME,
        revoked_at   DATETIME,
        PRIMARY KEY (token_hash),
        INDEX idx_cs_uuid (uuid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS cosmetic_owned (
        uuid        CHAR(32)     NOT NULL,
        cosmetic_id VARCHAR(40)  NOT NULL,
        granted_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        granted_by  VARCHAR(40),
        PRIMARY KEY (uuid, cosmetic_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS cosmetic_equipped (
        uuid        CHAR(32)     NOT NULL,
        slot        VARCHAR(16)  NOT NULL,
        cosmetic_id VARCHAR(40)  NOT NULL,
        PRIMARY KEY (uuid, slot)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function ensureCosmeticsTables(db) {
    for (const sql of TABLES) await db.query(sql);
}

module.exports = { ensureCosmeticsTables };

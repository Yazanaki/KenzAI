// app.js
// The whole API as an Express app, so it can run on its own (index.js) or
// inside KenzAI's process (KenzAI passes its MySQL pool and its own DM sender).
//
//   createApp({ db, sendCode, apiSecret, trustProxy }) → express app
//   ensureTables(db)                                  → creates launcher tables

const express = require('express');
const cors    = require('cors');

const createAuthRouter      = require('./auth/routes');
const createCosmeticsRouter = require('./cosmetics/routes');
const createModRouter       = require('./mod/routes');

function createApp({ db, sendCode, apiSecret = process.env.API_SECRET, trustProxy = process.env.TRUST_PROXY } = {}) {
    if (!db) throw new Error('createApp needs a MySQL pool (db).');
    const app = express();

    // Behind nginx/Cloudflare set TRUST_PROXY (e.g. "loopback") so rate limits see
    // the real client IP instead of the proxy's.
    if (trustProxy) app.set('trust proxy', trustProxy);

    app.use(cors());
    app.use(express.json({ limit: '32kb' }));

    // ── Public routes ───────────────────────────────────────────────────────
    // Mounted BEFORE the secret check: the launcher and the mod ship to players
    // and must not carry API_SECRET.
    app.use('/auth', createAuthRouter({ db, sendCode }));            // launcher sign-in (members)
    app.use('/cosmetics', createCosmeticsRouter({ db }));            // cosmetics for every client user
    app.use('/mod', createModRouter({ db }));                        // in-game mod, member device token

    // ── Auth middleware ─────────────────────────────────────────────────────────
    // Every request must include X-API-Secret header matching .env value.
    // This stops random people from querying your member data.
    app.use((req, res, next) => {
        const secret = req.headers['x-api-secret'];
        if (!apiSecret || secret !== apiSecret) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    });

    // ── GET /members ────────────────────────────────────────────────────────────
    // Returns all active empire members the mod needs to identify players.
    // Joins members → empire_ids → clans to resolve clan abbreviation + name.
    app.get('/members', async (req, res) => {
        try {
            const [rows] = await db.execute(`
                SELECT
                    m.minecraft_user,
                    m.empire_id,
                    m.yazanaki_rank,
                    m.status,
                    m.joined_clan,
                    COALESCE(c.abbr, ei.clan_abbr, '') AS clan_abbr,
                    COALESCE(c.name, m.joined_clan, '') AS clan_name
                FROM members m
                LEFT JOIN empire_ids ei ON ei.empire_id = m.empire_id AND ei.active = 1
                LEFT JOIN clans c       ON c.guild_id   = m.clan_guild_id
                WHERE m.status IN ('Military', 'Council', 'Royalty', 'Citizen')
                  AND m.minecraft_user != ''
            `);

            // Return as a clean array the mod can consume
            const members = rows.map(r => ({
                minecraft_user: r.minecraft_user,
                empire_id:      r.empire_id      || null,
                rank:           r.yazanaki_rank  || 'Member',
                status:         r.status,
                clan_abbr:      r.clan_abbr      || 'UNKNOWN',
                clan_name:      r.clan_name      || 'Unknown Clan',
            }));

            res.json(members);
        } catch (err) {
            console.error('[/members]', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    });

    // ── GET /member/:username ───────────────────────────────────────────────────
    // Look up a single player by their Minecraft username.
    // The mod can call this on-demand for players not in the cached list.
    app.get('/member/:username', async (req, res) => {
        try {
            const username = req.params.username;

            const [rows] = await db.execute(`
                SELECT
                    m.minecraft_user,
                    m.empire_id,
                    m.yazanaki_rank,
                    m.status,
                    m.joined_clan,
                    COALESCE(c.abbr, ei.clan_abbr, '') AS clan_abbr,
                    COALESCE(c.name, m.joined_clan, '')  AS clan_name
                FROM members m
                LEFT JOIN empire_ids ei ON ei.empire_id = m.empire_id AND ei.active = 1
                LEFT JOIN clans c       ON c.guild_id   = m.clan_guild_id
                WHERE LOWER(m.minecraft_user) = LOWER(?)
                  AND m.status IN ('Military', 'Council', 'Royalty', 'Citizen')
                LIMIT 1
            `, [username]);

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Member not found' });
            }

            const r = rows[0];
            res.json({
                minecraft_user: r.minecraft_user,
                empire_id:      r.empire_id      || null,
                rank:           r.yazanaki_rank  || 'Member',
                status:         r.status,
                clan_abbr:      r.clan_abbr      || 'UNKNOWN',
                clan_name:      r.clan_name      || 'Unknown Clan',
            });
        } catch (err) {
            console.error('[/member/:username]', err.message);
            res.status(500).json({ error: 'Database error' });
        }
    });

    // ── GET /health ─────────────────────────────────────────────────────────────
    // Simple health check — the mod pings this on startup to verify connectivity.
    app.get('/health', async (req, res) => {
        try {
            await db.execute('SELECT 1');
            res.json({ status: 'ok' });
        } catch (err) {
            res.status(500).json({ status: 'db_error', error: err.message });
        }
    });

    return app;
}

async function ensureTables(db) {
    await require('./auth/schema').ensureAuthTables(db);
    await require('./cosmetics/schema').ensureCosmeticsTables(db);
}

module.exports = { createApp, ensureTables };

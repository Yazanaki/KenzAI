// mod/routes.js
// Routes the in-game Yazanaki mod calls with an Empire member's launcher device
// token (the launcher hands it over per launch). Replaces sending API_SECRET
// from the mod: a secret baked into a jar that ships to players is not secret.
// Only active members get Empire data, so outsiders can't identify members.

const express = require('express');
const A = require('../auth/logic');

function create({ db }) {
    const router = express.Router();
    const perToken = A.createLimiter({ limit: 30, windowMs: 60 * 1000 });

    function bearer(req) {
        const h = String(req.headers.authorization || '');
        return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    }

    // → true when the token belongs to an active member's device.
    async function activeMember(token) {
        const [rows] = await db.execute(
            `SELECT m.status
             FROM launcher_devices d
             JOIN empire_ids ei ON ei.empire_id = d.empire_id AND ei.active = 1 AND ei.banned_at IS NULL
             JOIN members m     ON m.empire_id  = d.empire_id
             WHERE d.token_hash = ? AND d.revoked_at IS NULL
             LIMIT 1`, [A.sha256(token)]);
        return !!rows[0] && A.isActiveStatus(rows[0].status);
    }

    // ── GET /mod/members ────────────────────────────────────────────────────────
    // Same body as GET /members.
    router.get('/members', async (req, res) => {
        const token = bearer(req);
        if (!token) return res.status(401).json({ error: 'signed_out' });
        if (!perToken(A.sha256(token))) return res.status(429).json({ error: 'rate_limited' });
        try {
            if (!(await activeMember(token))) return res.status(403).json({ error: 'revoked' });
            const [rows] = await db.execute(`
                SELECT
                    m.minecraft_user,
                    m.empire_id,
                    m.yazanaki_rank,
                    m.status,
                    COALESCE(c.abbr, ei.clan_abbr, '') AS clan_abbr,
                    COALESCE(c.name, m.joined_clan, '') AS clan_name
                FROM members m
                LEFT JOIN empire_ids ei ON ei.empire_id = m.empire_id AND ei.active = 1
                LEFT JOIN clans c       ON c.guild_id   = m.clan_guild_id
                WHERE m.status IN ('Military', 'Council', 'Royalty', 'Citizen')
                  AND m.minecraft_user != ''
            `);
            res.json(rows.map((r) => ({
                minecraft_user: r.minecraft_user,
                empire_id:      r.empire_id      || null,
                rank:           r.yazanaki_rank  || 'Member',
                status:         r.status,
                clan_abbr:      r.clan_abbr      || 'UNKNOWN',
                clan_name:      r.clan_name      || 'Unknown Clan',
            })));
        } catch (err) {
            console.error('[/mod/members]', err.message);
            res.status(500).json({ error: 'server_error' });
        }
    });

    return router;
}

module.exports = create;


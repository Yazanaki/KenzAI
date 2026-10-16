// auth/routes.js
// Launcher (Yazanaki Client) sign-in. Public routes: the launcher is a public
// app, so it carries no shared secret. Instead a member proves who they are
// with a one-time 6-digit code that KenzAI DMs to their Discord account, and
// gets a per-device token back. See docs/api-contract.md.

const express = require('express');
const L = require('./logic');

// Default code delivery: ask KenzAI (co-located, localhost) to DM it. When the
// API runs inside KenzAI, KenzAI passes its own sendCode instead.
async function dmCode({ discordId, code, empireId }) {
    const base = process.env.KENZAI_INTERNAL_URL || 'http://127.0.0.1:4825';
    const secret = process.env.KENZAI_INTERNAL_SECRET;
    if (!secret) return { ok: false, reason: 'dm_not_configured' };
    try {
        const res = await fetch(`${base}/internal/login-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
            body: JSON.stringify({ discordId, code, empireId, expiresInMinutes: L.CODE_TTL_MINUTES }),
            signal: AbortSignal.timeout(10000),
        });
        const body = await res.json().catch(() => ({}));
        return res.ok ? { ok: true } : { ok: false, reason: body.reason || 'dm_failed' };
    } catch {
        return { ok: false, reason: 'bot_unreachable' };
    }
}

function create({ db, sendCode = dmCode }) {
    const router = express.Router();

    const perIp       = L.createLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
    const perEmpireId = L.createLimiter({ limit: 1,  windowMs: 60 * 1000 });
    const perEmpireHr = L.createLimiter({ limit: 5,  windowMs: 60 * 60 * 1000 });
    const verifyPerIp = L.createLimiter({ limit: 30, windowMs: 10 * 60 * 1000 });

    const MEMBER_SELECT = `
        SELECT m.discord_id, m.minecraft_user, m.empire_id, m.yazanaki_rank, m.status,
               COALESCE(c.abbr, ei.clan_abbr, '') AS clan_abbr,
               COALESCE(c.name, m.joined_clan, '') AS clan_name
        FROM empire_ids ei
        JOIN members m     ON m.empire_id = ei.empire_id
        LEFT JOIN clans c  ON c.guild_id  = m.clan_guild_id
        WHERE ei.empire_id = ? AND ei.active = 1 AND ei.banned_at IS NULL
        LIMIT 1`;

    async function findMember(empireId) {
        const [rows] = await db.execute(MEMBER_SELECT, [empireId]);
        const row = rows[0];
        return row && L.isActiveStatus(row.status) ? row : null;
    }

    function bearer(req) {
        const h = String(req.headers.authorization || '');
        return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    }

    const DM_MESSAGES = {
        dm_closed:         'KenzAI could not DM you. Allow DMs from server members in the Yazanaki Discord and try again.',
        user_not_found:    'Your Discord account could not be found. Ask an officer to check your EmpireID link.',
        bot_unreachable:   'The Empire bot is offline right now. Try again in a few minutes.',
        dm_not_configured: 'Sign-in codes are not set up on the server yet.',
    };

    // ── POST /auth/login/start ──────────────────────────────────────────────────
    router.post('/login/start', async (req, res) => {
        const empireId = L.normalizeEmpireId(req.body && req.body.empireId);
        if (!empireId) return res.status(400).json({ error: 'invalid_empire_id', message: 'That is not a valid EmpireID (e.g. SNU-000014).' });
        if (!perIp(req.ip)) return res.status(429).json({ error: 'rate_limited', message: 'Too many attempts. Wait a few minutes.' });
        if (!perEmpireId(empireId) || !perEmpireHr(empireId)) {
            return res.status(429).json({ error: 'rate_limited', message: 'A code was sent recently. Check your Discord DMs or wait a minute.' });
        }

        try {
            const member = await findMember(empireId);
            if (!member || !member.discord_id) {
                return res.status(404).json({ error: 'not_found', message: 'No active member has that EmpireID.' });
            }

            const challengeId = L.newId();
            const code = L.generateCode();
            // A new code replaces any older unused one for this EmpireID.
            await db.execute(
                'UPDATE launcher_login_challenges SET consumed_at = NOW() WHERE empire_id = ? AND consumed_at IS NULL',
                [empireId]);
            await db.execute(
                `INSERT INTO launcher_login_challenges
                   (challenge_id, empire_id, discord_id, code_hash, request_ip, expires_at)
                 VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
                [challengeId, empireId, member.discord_id, L.hashCode(challengeId, code), req.ip, L.CODE_TTL_MINUTES]);

            const sent = await sendCode({ discordId: member.discord_id, code, empireId });
            if (!sent.ok) {
                await db.execute('DELETE FROM launcher_login_challenges WHERE challenge_id = ?', [challengeId]);
                return res.status(502).json({ error: sent.reason, message: DM_MESSAGES[sent.reason] || 'Could not send your code. Try again.' });
            }

            res.json({ challengeId, expiresInSeconds: L.CODE_TTL_MINUTES * 60 });
        } catch (err) {
            console.error('[/auth/login/start]', err.message);
            res.status(500).json({ error: 'server_error', message: 'Server error. Try again.' });
        }
    });

    // ── POST /auth/login/verify ─────────────────────────────────────────────────
    router.post('/login/verify', async (req, res) => {
        const challengeId = String((req.body && req.body.challengeId) || '');
        const code = L.normalizeCode(req.body && req.body.code);
        const deviceName = String((req.body && req.body.deviceName) || '').slice(0, 100) || null;
        if (!/^[a-f0-9]{32}$/.test(challengeId) || !code) {
            return res.status(400).json({ error: 'invalid_code', message: 'Enter the 6-digit code from your DM.' });
        }
        if (!verifyPerIp(req.ip)) return res.status(429).json({ error: 'rate_limited', message: 'Too many attempts. Wait a few minutes.' });

        try {
            const [rows] = await db.execute(
                `SELECT challenge_id, empire_id, discord_id, code_hash, attempts,
                        consumed_at IS NOT NULL AS consumed, expires_at < NOW() AS expired
                 FROM launcher_login_challenges WHERE challenge_id = ?`, [challengeId]);
            const ch = rows[0];
            if (!ch || ch.consumed || ch.expired) {
                return res.status(410).json({ error: 'code_expired', message: 'This code has expired. Request a new one.' });
            }

            if (!L.codeMatches(challengeId, code, ch.code_hash)) {
                const attempts = ch.attempts + 1;
                const spent = attempts >= L.MAX_ATTEMPTS;
                await db.execute(
                    `UPDATE launcher_login_challenges SET attempts = ?${spent ? ', consumed_at = NOW()' : ''} WHERE challenge_id = ?`,
                    [attempts, challengeId]);
                return res.status(401).json(spent
                    ? { error: 'code_expired', message: 'Too many wrong codes. Request a new one.' }
                    : { error: 'wrong_code', message: 'That code is not right.', attemptsLeft: L.MAX_ATTEMPTS - attempts });
            }

            // Single use: only the request that flips consumed_at wins.
            const [upd] = await db.execute(
                'UPDATE launcher_login_challenges SET consumed_at = NOW() WHERE challenge_id = ? AND consumed_at IS NULL',
                [challengeId]);
            if (upd.affectedRows !== 1) {
                return res.status(410).json({ error: 'code_expired', message: 'This code was already used. Request a new one.' });
            }

            const member = await findMember(ch.empire_id);
            if (!member) return res.status(403).json({ error: 'revoked', message: 'Account Deactivated / Access Revoked' });

            const token = L.newDeviceToken();
            await db.execute(
                `INSERT INTO launcher_devices (token_hash, empire_id, discord_id, device_name, last_seen_at)
                 VALUES (?, ?, ?, ?, NOW())`,
                [L.sha256(token), ch.empire_id, ch.discord_id, deviceName]);

            res.json({ token, member: L.sanitizeMember(member) });
        } catch (err) {
            console.error('[/auth/login/verify]', err.message);
            res.status(500).json({ error: 'server_error', message: 'Server error. Try again.' });
        }
    });

    // ── POST /auth/validate ─────────────────────────────────────────────────────
    router.post('/validate', async (req, res) => {
        const token = bearer(req);
        if (!token) return res.status(401).json({ status: 'signed_out' });
        try {
            const [rows] = await db.execute(
                'SELECT empire_id FROM launcher_devices WHERE token_hash = ? AND revoked_at IS NULL', [L.sha256(token)]);
            if (!rows[0]) return res.status(401).json({ status: 'signed_out' });

            const member = await findMember(rows[0].empire_id);
            if (!member) {
                await db.execute('UPDATE launcher_devices SET revoked_at = NOW() WHERE token_hash = ?', [L.sha256(token)]);
                return res.status(403).json({ status: 'revoked', message: 'Account Deactivated / Access Revoked' });
            }
            await db.execute('UPDATE launcher_devices SET last_seen_at = NOW() WHERE token_hash = ?', [L.sha256(token)]);
            res.json({ status: 'active', member: L.sanitizeMember(member) });
        } catch (err) {
            console.error('[/auth/validate]', err.message);
            res.status(500).json({ status: 'error' });
        }
    });

    // ── POST /auth/logout ───────────────────────────────────────────────────────
    router.post('/logout', async (req, res) => {
        const token = bearer(req);
        if (token) {
            try {
                await db.execute('UPDATE launcher_devices SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL', [L.sha256(token)]);
            } catch (err) {
                console.error('[/auth/logout]', err.message);
            }
        }
        res.json({ ok: true });
    });

    return router;
}

module.exports = create;


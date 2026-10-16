// cosmetics/routes.js
// Client cosmetics for everyone who uses the Yazanaki Client. Public routes
// (mounted before the X-API-Secret check). See docs/api-contract.md.
//
//   launcher: sign in (Mojang join check), list owned, equip
//   mod:      look up what nearby players wear, download textures

const express = require('express');
const path = require('path');
const A = require('../auth/logic');
const C = require('./logic');

function create({ db }) {
    const router = express.Router();

    const challenges = C.createChallengeStore();
    const startPerIp  = A.createLimiter({ limit: 20,  windowMs: 10 * 60 * 1000 });
    const verifyPerIp = A.createLimiter({ limit: 20,  windowMs: 10 * 60 * 1000 });
    const lookupPerIp = A.createLimiter({ limit: 120, windowMs: 60 * 1000 });

    function bearer(req) {
        const h = String(req.headers.authorization || '');
        return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    }

    async function sessionUuid(req) {
        const token = bearer(req);
        if (!token) return null;
        const [rows] = await db.execute(
            'SELECT uuid FROM cosmetic_sessions WHERE token_hash = ? AND revoked_at IS NULL', [A.sha256(token)]);
        if (!rows[0]) return null;
        await db.execute('UPDATE cosmetic_sessions SET last_seen_at = NOW() WHERE token_hash = ?', [A.sha256(token)]);
        return rows[0].uuid;
    }

    async function me(uuid) {
        const [owned] = await db.execute(
            'SELECT cosmetic_id, granted_at FROM cosmetic_owned WHERE uuid = ? ORDER BY granted_at', [uuid]);
        const [equipped] = await db.execute(
            'SELECT slot, cosmetic_id FROM cosmetic_equipped WHERE uuid = ?', [uuid]);
        return C.meBody(uuid, owned, equipped);
    }

    // Ask Mojang whether this account joined our server id. → { id, name } or null.
    async function hasJoined(name, serverId) {
        try {
            const res = await fetch(C.hasJoinedUrl(name, serverId), { signal: AbortSignal.timeout(8000) });
            if (res.status !== 200) return null;
            const body = await res.json();
            const id = C.normalizeUuid(body && body.id);
            return id ? { id, name: String(body.name || name).slice(0, 16) } : null;
        } catch {
            return null;
        }
    }

    function serverError(where, res, err) {
        console.error(`[${where}]`, err.message);
        res.status(500).json({ error: 'server_error', message: 'Server error. Try again.' });
    }

    // ── GET /cosmetics/catalog ──────────────────────────────────────────────────
    router.get('/catalog', (req, res) => {
        res.json({ items: C.CATALOG.map((c) => ({ ...c, texture: C.textureInfo(c.id) })) });
    });

    // ── GET /cosmetics/textures/:id.png ─────────────────────────────────────────
    router.get('/textures/:file', (req, res) => {
        const m = /^([a-z0-9-]{1,40})\.png$/.exec(req.params.file);
        if (!m || !C.catalogItem(m[1])) return res.status(404).end();
        res.set('Cache-Control', 'public, max-age=86400');
        res.sendFile(path.join(C.TEXTURE_DIR, `${m[1]}.png`));
    });

    // ── POST /cosmetics/lookup ──────────────────────────────────────────────────
    // What these players wear. Public: cosmetics are meant to be seen.
    router.post('/lookup', async (req, res) => {
        const uuids = C.parseUuidList(req.body && req.body.uuids);
        if (!uuids) return res.status(400).json({ error: 'invalid_uuids', message: 'Send { uuids: [...] }.' });
        if (!lookupPerIp(req.ip)) return res.status(429).json({ error: 'rate_limited', message: 'Too many lookups.' });
        if (!uuids.length) return res.json({ players: {}, textures: {} });
        try {
            const marks = uuids.map(() => '?').join(',');
            const [rows] = await db.execute(
                `SELECT e.uuid, e.slot, e.cosmetic_id
                 FROM cosmetic_equipped e
                 JOIN cosmetic_owned o ON o.uuid = e.uuid AND o.cosmetic_id = e.cosmetic_id
                 WHERE e.uuid IN (${marks})`, uuids);
            res.set('Cache-Control', 'no-store');
            res.json(C.lookupBody(rows));
        } catch (err) {
            serverError('/cosmetics/lookup', res, err);
        }
    });

    // ── POST /cosmetics/login/start ─────────────────────────────────────────────
    // → { serverId }. The launcher joins it at Mojang, then calls verify.
    router.post('/login/start', (req, res) => {
        if (!startPerIp(req.ip)) return res.status(429).json({ error: 'rate_limited', message: 'Too many attempts. Wait a few minutes.' });
        res.json({ serverId: challenges.issue() });
    });

    // ── POST /cosmetics/login/verify ────────────────────────────────────────────
    // Body { name, serverId, appVersion } → { token, uuid, owned, equipped }.
    router.post('/login/verify', async (req, res) => {
        const body = req.body || {};
        const name = C.normalizeName(body.name);
        const serverId = String(body.serverId || '');
        if (!name || !/^[0-9a-f]{40}$/.test(serverId)) {
            return res.status(400).json({ error: 'invalid_request', message: 'Missing name or serverId.' });
        }
        if (!verifyPerIp(req.ip)) return res.status(429).json({ error: 'rate_limited', message: 'Too many attempts. Wait a few minutes.' });
        if (!challenges.consume(serverId)) {
            return res.status(410).json({ error: 'expired', message: 'Sign-in expired. Try again.' });
        }

        const profile = await hasJoined(name, serverId);
        if (!profile) {
            return res.status(401).json({ error: 'not_verified', message: 'Mojang could not confirm this Minecraft account.' });
        }

        try {
            await db.execute(
                `INSERT INTO cosmetic_players (uuid, name, last_seen_at) VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE name = VALUES(name), last_seen_at = NOW()`,
                [profile.id, profile.name]);

            if (C.shouldGrantOg(body.appVersion)) {
                const [ins] = await db.execute(
                    `INSERT IGNORE INTO cosmetic_owned (uuid, cosmetic_id, granted_by) VALUES (?, 'og-cape', 'og')`,
                    [profile.id]);
                // Wear it straight away the first time, unless a cape is already on.
                if (ins.affectedRows === 1) {
                    await db.execute(
                        `INSERT IGNORE INTO cosmetic_equipped (uuid, slot, cosmetic_id) VALUES (?, 'cape', 'og-cape')`,
                        [profile.id]);
                }
            }

            const token = A.newDeviceToken();
            await db.execute(
                'INSERT INTO cosmetic_sessions (token_hash, uuid, last_seen_at) VALUES (?, ?, NOW())',
                [A.sha256(token), profile.id]);
            res.json({ token, ...(await me(profile.id)) });
        } catch (err) {
            serverError('/cosmetics/login/verify', res, err);
        }
    });

    // ── GET /cosmetics/me ───────────────────────────────────────────────────────
    router.get('/me', async (req, res) => {
        try {
            const uuid = await sessionUuid(req);
            if (!uuid) return res.status(401).json({ error: 'signed_out' });
            res.json(await me(uuid));
        } catch (err) {
            serverError('/cosmetics/me', res, err);
        }
    });

    // ── PUT /cosmetics/me/equipped ──────────────────────────────────────────────
    // Body { slot, cosmeticId } to wear, cosmeticId null to take the slot off.
    router.put('/me/equipped', async (req, res) => {
        const slot = String((req.body && req.body.slot) || '');
        const id = req.body && req.body.cosmeticId;
        if (!C.SLOTS.includes(slot)) return res.status(400).json({ error: 'invalid_slot', message: 'Unknown cosmetic slot.' });
        try {
            const uuid = await sessionUuid(req);
            if (!uuid) return res.status(401).json({ error: 'signed_out' });

            if (id === null || id === undefined) {
                await db.execute('DELETE FROM cosmetic_equipped WHERE uuid = ? AND slot = ?', [uuid, slot]);
            } else {
                const item = C.catalogItem(String(id));
                if (!item || item.slot !== slot) return res.status(400).json({ error: 'unknown_cosmetic', message: 'Unknown cosmetic.' });
                const [own] = await db.execute(
                    'SELECT 1 FROM cosmetic_owned WHERE uuid = ? AND cosmetic_id = ?', [uuid, item.id]);
                if (!own[0]) return res.status(403).json({ error: 'not_owned', message: "You don't own this cosmetic yet." });
                await db.execute(
                    `INSERT INTO cosmetic_equipped (uuid, slot, cosmetic_id) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE cosmetic_id = VALUES(cosmetic_id)`,
                    [uuid, slot, item.id]);
            }
            res.json(await me(uuid));
        } catch (err) {
            serverError('/cosmetics/me/equipped', res, err);
        }
    });

    // ── POST /cosmetics/logout ──────────────────────────────────────────────────
    router.post('/logout', async (req, res) => {
        const token = bearer(req);
        if (token) {
            try {
                await db.execute('UPDATE cosmetic_sessions SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL', [A.sha256(token)]);
            } catch (err) {
                console.error('[/cosmetics/logout]', err.message);
            }
        }
        res.json({ ok: true });
    });

    return router;
}

module.exports = create;


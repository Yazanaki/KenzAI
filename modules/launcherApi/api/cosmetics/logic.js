// cosmetics/logic.js
// Pure helpers for client cosmetics (no DB, no network) so they can be tested.
//
// Cosmetics are for everyone who uses the Yazanaki Client, not only Empire
// members. A player proves they own a Minecraft account the same way a server
// does: the launcher "joins" a random server id at Mojang, and we ask Mojang's
// hasJoined whether that account did. The Minecraft access token never reaches
// this API.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TEXTURE_DIR = path.join(__dirname, 'textures');

// id → what it is. Textures are PNGs in cosmetics/textures/<id>.png.
const CATALOG = [
    { id: 'og-cape', slot: 'cape', name: 'OG Cloak' },
];
const SLOTS = ['cape'];

// The OG cloak is for players who sign in while the client is in testing.
const OG_BEFORE = [1, 0, 0];

const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const MAX_LOOKUP = 100;

function normalizeUuid(value) {
    const id = String(value || '').trim().toLowerCase().replace(/-/g, '');
    return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

// → unique, valid UUIDs (at most MAX_LOOKUP), or null when the input isn't a list.
function parseUuidList(value) {
    if (!Array.isArray(value)) return null;
    const out = new Set();
    for (const v of value) {
        const id = normalizeUuid(v);
        if (id) out.add(id);
        if (out.size >= MAX_LOOKUP) break;
    }
    return [...out];
}

// Minecraft names: 3–16 of letters, digits, underscore.
function normalizeName(value) {
    const name = String(value || '').trim();
    return /^[A-Za-z0-9_]{3,16}$/.test(name) ? name : null;
}

function versionBefore(version, limit) {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
    if (!m) return false;
    const v = m.slice(1, 4).map(Number);
    for (let i = 0; i < 3; i++) {
        if (v[i] !== limit[i]) return v[i] < limit[i];
    }
    return false;
}

// The client reports its version. Lying only gets a cloak someone could have
// had anyway, and OG_CAPE_CLOSED=1 ends the grant for good.
function shouldGrantOg(appVersion, env = process.env) {
    return env.OG_CAPE_CLOSED !== '1' && versionBefore(appVersion, OG_BEFORE);
}

function catalogItem(id) {
    return CATALOG.find((c) => c.id === id) || null;
}

const textureHashes = new Map();
function textureInfo(id) {
    if (!catalogItem(id)) return null;
    if (!textureHashes.has(id)) {
        const file = path.join(TEXTURE_DIR, `${id}.png`);
        const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        textureHashes.set(id, sha256);
    }
    return { url: `/cosmetics/textures/${id}.png`, sha256: textureHashes.get(id) };
}

// rows: [{ uuid, slot, cosmetic_id }] → the /cosmetics/lookup body.
function lookupBody(rows) {
    const players = {};
    const textures = {};
    for (const r of rows) {
        const item = catalogItem(r.cosmetic_id);
        if (!item || item.slot !== r.slot) continue;
        (players[r.uuid] = players[r.uuid] || {})[r.slot] = item.id;
        textures[item.id] = textureInfo(item.id);
    }
    return { players, textures };
}

// owned rows [{ cosmetic_id, granted_at }], equipped rows [{ slot, cosmetic_id }]
function meBody(uuid, owned, equipped) {
    const ownedIds = new Set(owned.map((o) => o.cosmetic_id));
    const eq = {};
    for (const e of equipped) if (ownedIds.has(e.cosmetic_id)) eq[e.slot] = e.cosmetic_id;
    return {
        uuid,
        owned: owned
            .filter((o) => catalogItem(o.cosmetic_id))
            .map((o) => ({ id: o.cosmetic_id, grantedAt: new Date(o.granted_at).toISOString() })),
        equipped: eq,
    };
}

// Server ids handed to the launcher for Mojang's join check, single use.
function createChallengeStore({ ttlMs = CHALLENGE_TTL_MS } = {}) {
    const open = new Map();
    return {
        issue(now = Date.now()) {
            if (open.size > 5000) for (const [k, t] of open) if (now - t >= ttlMs) open.delete(k);
            const serverId = crypto.randomBytes(20).toString('hex');
            open.set(serverId, now);
            return serverId;
        },
        // true once per live id.
        consume(serverId, now = Date.now()) {
            const t = open.get(serverId);
            open.delete(serverId);
            return t !== undefined && now - t < ttlMs;
        },
    };
}

function hasJoinedUrl(name, serverId) {
    const q = new URLSearchParams({ username: name, serverId });
    return `https://sessionserver.mojang.com/session/minecraft/hasJoined?${q}`;
}

module.exports = {
    CATALOG,
    SLOTS,
    MAX_LOOKUP,
    TEXTURE_DIR,
    normalizeUuid,
    parseUuidList,
    normalizeName,
    versionBefore,
    shouldGrantOg,
    catalogItem,
    textureInfo,
    lookupBody,
    meBody,
    createChallengeStore,
    hasJoinedUrl,
};

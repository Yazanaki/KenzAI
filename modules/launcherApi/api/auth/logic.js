// auth/logic.js
// Pure helpers for launcher sign-in (no DB, no network) so they can be tested.

const crypto = require('crypto');

const CODE_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const ACTIVE_STATUSES = ['Military', 'Council', 'Royalty', 'Citizen'];

// EmpireIDs look like "SNU-000014": clan abbreviation, dash, 6 digits.
const EMPIRE_ID_RE = /^[A-Z0-9]{2,10}-\d{6}$/;

function normalizeEmpireId(value) {
    const id = String(value || '').trim().toUpperCase();
    return EMPIRE_ID_RE.test(id) ? id : null;
}

// Accepts "123 456" or "123-456" as typed, returns "123456" or null.
function normalizeCode(value) {
    const code = String(value || '').replace(/[\s-]/g, '');
    return /^\d{6}$/.test(code) ? code : null;
}

function generateCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function newId(bytes = 16) {
    return crypto.randomBytes(bytes).toString('hex');
}

function newDeviceToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// The challenge id salts the hash, so equal codes never share a hash.
function hashCode(challengeId, code) {
    return sha256(`${challengeId}:${code}`);
}

function codeMatches(challengeId, code, storedHash) {
    const a = Buffer.from(hashCode(challengeId, code), 'hex');
    const b = Buffer.from(String(storedHash || ''), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isActiveStatus(status) {
    return ACTIVE_STATUSES.includes(status);
}

// Only what the launcher may see. Never Discord IDs or internal columns.
function sanitizeMember(row) {
    return {
        empireId: row.empire_id,
        name:     row.minecraft_user || null,
        clan:     row.clan_abbr || null,
        clanName: row.clan_name || null,
        rank:     row.yazanaki_rank || 'Member',
        status:   row.status,
    };
}

// Tiny fixed-window rate limiter kept in memory (one API process under pm2).
function createLimiter({ limit, windowMs }) {
    const hits = new Map();
    return function allow(key, now = Date.now()) {
        const entry = hits.get(key);
        if (!entry || now - entry.start >= windowMs) {
            hits.set(key, { start: now, count: 1 });
            if (hits.size > 10000) {
                for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
            }
            return true;
        }
        entry.count += 1;
        return entry.count <= limit;
    };
}

module.exports = {
    CODE_TTL_MINUTES,
    MAX_ATTEMPTS,
    ACTIVE_STATUSES,
    normalizeEmpireId,
    normalizeCode,
    generateCode,
    newId,
    newDeviceToken,
    sha256,
    hashCode,
    codeMatches,
    isActiveStatus,
    sanitizeMember,
    createLimiter,
};

/* Auth primitives — password hashing (scrypt) + signed session tokens.
   No external deps; uses Node's crypto. Tokens are HMAC-signed so they can't
   be forged without the server secret. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// persistent server secret (generated once, stored outside web root)
const SECRET_FILE = path.join(__dirname, 'data', '.secret');
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8'); }
catch (e) {
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [, salt, hash] = stored.split('$');
    const test = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(test));
  } catch (e) { return false; }
}

// stateless signed token: base64(payload).hmac  — payload carries uid+exp
function signToken(payload, ttlMs = 30 * 24 * 3600 * 1000) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch (e) { return null; }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };

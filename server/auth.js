// Autenticação real do painel administrativo: hash de senha com scrypt (nativo do Node,
// sem dependências externas) + sessões com token aleatório armazenado no banco de dados.
import crypto from 'node:crypto';
import { db, nowIso } from './db.js';

const SESSION_COOKIE = 'njfilmes_session';
const SESSION_DAYS = 7;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createAdminUser({ email, password, name }) {
  const { hash, salt } = hashPassword(password);
  const stmt = db.prepare(
    'INSERT INTO admin_users (email, password_hash, salt, name) VALUES (?, ?, ?, ?)'
  );
  const info = stmt.run(String(email).toLowerCase().trim(), hash, salt, name || 'Administrador');
  return info.lastInsertRowid;
}

export function findAdminByEmail(email) {
  return db.prepare('SELECT * FROM admin_users WHERE email = ?').get(String(email).toLowerCase().trim());
}

export function countAdmins() {
  return db.prepare('SELECT COUNT(*) as c FROM admin_users').get().c;
}

export function createSession(adminId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, admin_id, expires_at) VALUES (?, ?, ?)').run(id, adminId, expires);
  return { id, expires };
}

export function destroySession(sessionId) {
  if (!sessionId) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function getSessionAdmin(sessionId) {
  if (!sessionId) return null;
  const row = db
    .prepare(
      `SELECT s.id as session_id, s.expires_at, a.id, a.email, a.name
       FROM sessions s JOIN admin_users a ON a.id = s.admin_id
       WHERE s.id = ?`
    )
    .get(sessionId);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(sessionId);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  });
  return out;
}

export function getSessionIdFromReq(req) {
  return parseCookies(req)[SESSION_COOKIE];
}

export function setSessionCookie(res, sessionId, expiresDate) {
  const expires = expiresDate ? new Date(expiresDate).toUTCString() : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export { nowIso };

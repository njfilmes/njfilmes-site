// Autenticação real do painel administrativo: hash de senha com scrypt (nativo do Node,
// sem dependências externas) + sessões com token aleatório armazenado no banco de dados.
import crypto from 'node:crypto';
import { query, queryOne } from './db.js';

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

export async function createAdminUser({ email, password, name }) {
  const { hash, salt } = hashPassword(password);
  const row = await queryOne(
    'INSERT INTO admin_users (email, password_hash, salt, name) VALUES ($1, $2, $3, $4) RETURNING id',
    [String(email).toLowerCase().trim(), hash, salt, name || 'Administrador']
  );
  return row.id;
}

export async function findAdminByEmail(email) {
  return queryOne('SELECT * FROM admin_users WHERE email = $1', [String(email).toLowerCase().trim()]);
}

export async function countAdmins() {
  const row = await queryOne('SELECT COUNT(*) as c FROM admin_users');
  return Number(row.c);
}

export async function createSession(adminId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await query('INSERT INTO sessions (id, admin_id, expires_at) VALUES ($1, $2, $3)', [id, adminId, expires]);
  return { id, expires };
}

export async function destroySession(sessionId) {
  if (!sessionId) return;
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function getSessionAdmin(sessionId) {
  if (!sessionId) return null;
  const row = await queryOne(
    `SELECT s.id as session_id, s.expires_at, a.id, a.email, a.name
     FROM sessions s JOIN admin_users a ON a.id = s.admin_id
     WHERE s.id = $1`,
    [sessionId]
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(sessionId);
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
    // Um cookie malformado (ex.: "%" sozinho) faz decodeURIComponent lançar erro — nesse caso
    // simplesmente ignora esse cookie em vez de derrubar a requisição inteira com um 500.
    let v;
    try {
      v = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return;
    }
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
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export function nowIso() {
  return new Date().toISOString();
}

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'desconhecido';
}

// Proteção contra tentativas repetidas de adivinhar a senha do admin (login) ou a chave de
// recuperação de acesso - adicionado em 04/09/2026, nenhum dos dois tinha limite nenhum antes
// disso, então um script conseguia tentar senha atrás de senha sem parar. Guarda em memória, por
// IP: depois de várias tentativas ERRADAS seguidas numa janela de tempo, bloqueia novas
// tentativas daquele IP por um tempo, mesmo que a senha certa venha em seguida logo depois (isso
// é o que impede um script de simplesmente continuar tentando). Uma tentativa CERTA limpa o
// histórico daquele IP na hora. Reinicia se o serviço reiniciar - aceitável pra esse nível de
// proteção, igual ao limitador de comentários/curtidas em server/routes/public.js.
const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutos
const LOGIN_LOCKOUT_MAX_ATTEMPTS = 8; // tentativas erradas permitidas nesse período
const LOGIN_LOCKOUT_BLOCK_MS = 15 * 60 * 1000; // tempo bloqueado depois de estourar o limite

function makeLoginGuard() {
  const byIp = new Map(); // ip -> { attempts: number[], blockedUntil: number|null }
  return {
    isBlocked(ip) {
      const entry = byIp.get(ip);
      if (!entry || !entry.blockedUntil) return false;
      if (Date.now() > entry.blockedUntil) {
        entry.blockedUntil = null;
        entry.attempts = [];
        return false;
      }
      return true;
    },
    registerFailure(ip) {
      const now = Date.now();
      const entry = byIp.get(ip) || { attempts: [], blockedUntil: null };
      entry.attempts = entry.attempts.filter((t) => now - t < LOGIN_LOCKOUT_WINDOW_MS);
      entry.attempts.push(now);
      if (entry.attempts.length >= LOGIN_LOCKOUT_MAX_ATTEMPTS) {
        entry.blockedUntil = now + LOGIN_LOCKOUT_BLOCK_MS;
      }
      byIp.set(ip, entry);
    },
    registerSuccess(ip) {
      byIp.delete(ip);
    },
  };
}

// Um "guarda" separado pra cada endpoint - assim estourar tentativas no login não bloqueia
// também a recuperação de senha (e vice-versa).
export const loginGuard = makeLoginGuard();
export const recoveryGuard = makeLoginGuard();

import crypto from 'node:crypto';
import { q, q1 } from './db.js';
import { HttpError } from './http.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), 32);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Slow down password guessing: 8 failures per address in 10 minutes locks sign-in for that address.
const fails = new Map();
const WINDOW = 10 * 60e3, LIMIT = 8;
function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}
function checkLimit(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter((t) => now - t < WINDOW);
  fails.set(ip, list);
  if (list.length >= LIMIT) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}

export async function login(req, { profileId, name, password }) {
  const ip = clientIp(req);
  checkLimit(ip);
  const p = profileId ? await q1('select * from profiles where id=$1', [profileId])
    : await q1('select * from profiles where lower(name)=lower($1)', [String(name || '')]);
  if (!p || !checkPassword(password ?? '', p.pass)) {
    fails.get(ip).push(Date.now());
    throw new HttpError(401, 'Wrong password');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await q('insert into sessions (token, profile_id, device) values ($1, $2, $3)',
    [token, p.id, String(req.headers['user-agent'] || '').slice(0, 200)]);
  return { token, profile: publicProfile(p) };
}

export const publicProfile = (p) => ({ id: p.id, name: p.name, admin: p.is_admin, avatar: p.avatar, color: p.color });

export function tokenFrom(ctx) {
  const h = ctx.req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  if (ctx.query.t) return ctx.query.t;
  const m = /(?:^|;\s*)hf_token=([^;]+)/.exec(ctx.req.headers.cookie || '');
  return m ? m[1] : null;
}

const seen = new Map();
export async function authenticate(ctx) {
  const token = tokenFrom(ctx);
  if (!token) return null;
  const p = await q1(`select p.* from sessions s join profiles p on p.id = s.profile_id where s.token=$1`, [token]);
  if (!p) return null;
  const now = Date.now();
  if (now - (seen.get(token) || 0) > 3600e3) {
    seen.set(token, now);
    q('update sessions set seen_at=now() where token=$1', [token]).catch(() => {});
  }
  return p;
}

export const sessionCookie = (token) =>
  `hf_token=${token}; Path=/; Max-Age=${token ? 400 * 86400 : 0}; HttpOnly; SameSite=Lax`;

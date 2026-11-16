import pg from 'pg';
import { cfg } from './config.js';

pg.types.setTypeParser(20, Number); // bigint ids as numbers
pg.types.setTypeParser(1082, (v) => v); // dates as YYYY-MM-DD strings

let pool;
export function db() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: cfg.dbUrl, max: 10 });
    pool.on('error', (e) => console.error('[db]', e.message));
  }
  return pool;
}
export const q = async (sql, params = []) => (await db().query(sql, params)).rows;
export const q1 = async (sql, params = []) => (await q(sql, params))[0] || null;
export async function closeDb() { if (pool) { await pool.end(); pool = null; } }

const MIGRATIONS = [
  `create table settings (key text primary key, value jsonb not null);
   create table profiles (
     id serial primary key, name text not null unique, pass text not null,
     is_admin boolean not null default false, avatar text, color text, created_at timestamptz not null default now());
   create table sessions (
     token text primary key, profile_id int not null references profiles on delete cascade,
     device text, created_at timestamptz not null default now(), seen_at timestamptz not null default now());
   create table libraries (
     id serial primary key, name text not null, kind text not null, path text not null,
     position int not null default 0, look jsonb not null default '{}', created_at timestamptz not null default now());
   create table items (
     id bigserial primary key, library_id int not null references libraries on delete cascade, kind text not null,
     parent_id bigint references items on delete cascade, show_id bigint references items on delete cascade,
     title text not null, sort_title text, year int, overview text, tagline text, runtime_s real,
     season_no int, episode_no int, path text unique, size bigint, mtime bigint,
     container text, streams jsonb, bitrate bigint,
     tmdb_id int, matched boolean not null default false,
     genres text[] not null default '{}', tags text[] not null default '{}', studios text[] not null default '{}',
     rating text, score real, people jsonb not null default '[]',
     poster text, backdrop text, logo text, trailer text, premiered date,
     added_at timestamptz not null default now(), locked jsonb not null default '{}');
   create index items_lib_kind on items (library_id, kind);
   create index items_parent on items (parent_id);
   create index items_show on items (show_id);
   create index items_genres on items using gin (genres);
   create table progress (
     profile_id int not null references profiles on delete cascade, item_id bigint not null references items on delete cascade,
     position_s real not null default 0, duration_s real, watched boolean not null default false,
     updated_at timestamptz not null default now(), primary key (profile_id, item_id));
   create table mylist (
     profile_id int not null references profiles on delete cascade, item_id bigint not null references items on delete cascade,
     added_at timestamptz not null default now(), primary key (profile_id, item_id));
   create table seasons (
     id serial primary key, name text not null, starts text not null, ends text not null,
     enabled boolean not null default true, look jsonb not null default '{}');
   create table preroll_rules (
     id serial primary key, name text not null, enabled boolean not null default true, position int not null default 0,
     clips jsonb not null default '{"mode":"all"}', match jsonb not null default '{}', count int not null default 1);`,
];

export async function migrate({ retries = 30 } = {}) {
  for (let i = 0; ; i++) {
    try { await q('select 1'); break; } catch (e) {
      if (i >= retries) throw e;
      console.log('[db] waiting for database…'); await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await q('create table if not exists schema_version (v int not null)');
  const row = await q1('select max(v) as v from schema_version');
  const at = row?.v ?? 0;
  for (let i = at; i < MIGRATIONS.length; i++) {
    const client = await db().connect();
    try {
      await client.query('begin');
      await client.query(MIGRATIONS[i]);
      await client.query('insert into schema_version (v) values ($1)', [i + 1]);
      await client.query('commit');
      console.log(`[db] applied migration ${i + 1}`);
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  }
}

const cache = new Map();
export async function getSetting(key, fallback = null) {
  if (cache.has(key)) return cache.get(key);
  const row = await q1('select value from settings where key=$1', [key]);
  const v = row ? row.value : fallback;
  cache.set(key, v);
  return v;
}
export async function setSetting(key, value) {
  await q(`insert into settings (key, value) values ($1, $2::jsonb)
           on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
  cache.set(key, value);
}
export const clearSettingsCache = () => cache.clear();

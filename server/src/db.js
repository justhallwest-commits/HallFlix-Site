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

export const MIGRATIONS = [
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
  // 2: titles an admin removed from HallFlix but kept on the NAS. The scanner skips these paths (and anything under them).
  `create table hidden (
     id serial primary key, library_id int references libraries on delete cascade, path text not null unique,
     title text not null, kind text not null, hidden_at timestamptz not null default now());`,
  // 3: intro/credits marks per title, and hand-made collections.
  `alter table items add column marks jsonb not null default '{}';
   create table collections (
     id serial primary key, name text not null, description text, backdrop text, logo text,
     position int not null default 0, created_at timestamptz not null default now());
   create table collection_items (
     collection_id int not null references collections on delete cascade, item_id bigint not null references items on delete cascade,
     position int not null default 0, primary key (collection_id, item_id));`,
  // 4: books, comics and music.
  `alter table items add column author text, add column pages int, add column extra jsonb not null default '{}';
   create index items_author on items (library_id, kind, author);`,
  // 5: playlists and bookmarks.
  `create table playlists (id serial primary key, profile_id int not null references profiles on delete cascade, name text not null, created_at timestamptz not null default now());
   create table playlist_items (playlist_id int not null references playlists on delete cascade, item_id bigint not null references items on delete cascade,
     position int not null default 0, added_at timestamptz not null default now(), primary key (playlist_id, item_id));
   create table bookmarks (id serial primary key, profile_id int not null references profiles on delete cascade, item_id bigint not null references items on delete cascade,
     position real not null, label text, created_at timestamptz not null default now());
   create index bookmarks_item on bookmarks (profile_id, item_id);`,
  // 6: hand edits that survive rescans, the metadata editor's history, and pre-roll play records.
  `alter table items add column edits jsonb not null default '{}';
   create table meta_history (id serial primary key, label text not null, changes jsonb not null, undoes int, undone boolean not null default false,
     created_at timestamptz not null default now());
   create table preroll_plays (id bigserial primary key, profile_id int references profiles on delete cascade, clip_id bigint references items on delete cascade,
     item_id bigint references items on delete set null, rule text, played_at timestamptz not null default now());
   create index preroll_plays_profile on preroll_plays (profile_id, played_at desc);
   create index preroll_plays_clip on preroll_plays (clip_id);`,
  // 7: lyrics found online (or chosen by hand), and every song played, for Most played and On repeat.
  `create table lyrics (item_id bigint primary key references items on delete cascade, source text, synced jsonb, plain text,
     offset_s real not null default 0, missing boolean not null default false, chosen boolean not null default false, fetched_at timestamptz not null default now());
   create table plays (id bigserial primary key, profile_id int not null references profiles on delete cascade, item_id bigint not null references items on delete cascade,
     played_at timestamptz not null default now());
   create index plays_profile on plays (profile_id, played_at desc);
   create index plays_item on plays (item_id);`,
  // 8: ratings from outside services (IMDb, Rotten Tomatoes…), and subtitles downloaded from subtitle services.
  `create table ratings (item_id bigint primary key references items on delete cascade, data jsonb not null default '[]', imdb_id text,
     missing boolean not null default false, fetched_at timestamptz not null default now());
   create table subtitles (id serial primary key, item_id bigint not null references items on delete cascade, lang text, label text not null,
     provider text, file text not null, hi boolean not null default false, created_at timestamptz not null default now());
   create index subtitles_item on subtitles (item_id);`,
  // Home and the library pages ask for the newest titles all the time; these keep that quick in big libraries.
  `create index if not exists items_lib_kind_added on items (library_id, kind, added_at desc);
   create index if not exists items_kind_added on items (kind, added_at desc);
   create index if not exists progress_profile_updated on progress (profile_id, updated_at desc);`,
  // 10: pre-roll tags live with the pre-roll tool, apart from metadata tags. Tags typed on clips move over (a clip's
  // sub-folder names are worked out from its path instead, so they're not copied), and clips' metadata tags are cleared.
  `create table preroll_tags (clip_id bigint not null references items on delete cascade, tag text not null, primary key (clip_id, tag));
   insert into preroll_tags (clip_id, tag)
     select distinct i.id, lower(trim(t)) from items i, jsonb_array_elements_text(case when jsonb_typeof(i.edits->'tags') = 'array' then i.edits->'tags' else '[]'::jsonb end) t
     where i.kind = 'clip' and trim(t) <> '' and position('/' || lower(trim(t)) || '/' in lower(replace(i.path, chr(92), '/'))) = 0
     on conflict do nothing;
   update items set tags = '{}', locked = locked - 'tags', edits = edits - 'tags' where kind = 'clip';`,
  // 11: how loud pre-rolls, idents and features are, so pre-rolls can play at the movie's level. Keyed by file path.
  `create table loudness (path text primary key, mtime bigint not null, lufs real not null, measured_at timestamptz not null default now());`,
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

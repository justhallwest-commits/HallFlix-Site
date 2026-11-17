import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

export const cfg = {
  port: +(env.PORT || 8780),
  dbUrl: env.DATABASE_URL || 'postgres://hallflix:hallflix@localhost:5432/hallflix',
  dataDir: env.DATA_DIR || '/data',
  mediaRoot: env.MEDIA_ROOT || '/media',
  webDir: env.WEB_DIR || path.resolve(here, '../../web'),
  transcoderUrl: env.TRANSCODER_URL || 'http://127.0.0.1:8781',
  transcoderPort: +(env.TRANSCODER_PORT || 8781),
  transcodeDir: env.TRANSCODE_DIR || '/transcode',
  tmdbBase: env.TMDB_BASE || 'https://api.themoviedb.org/3',
  tmdbImg: env.TMDB_IMG || 'https://image.tmdb.org/t/p',
  ffmpeg: env.FFMPEG || 'ffmpeg',
  ffprobe: env.FFPROBE || 'ffprobe',
  hw: env.HALLFLIX_HW || 'auto', // auto | off
  lrclibBase: env.LRCLIB_BASE || 'https://lrclib.net', // the free synced-lyrics database
  // Ratings and subtitle services (addresses can be changed for testing or a mirror).
  omdbBase: env.OMDB_BASE || 'https://www.omdbapi.com',
  mdblistBase: env.MDBLIST_BASE || 'https://api.mdblist.com',
  opensubsBase: env.OPENSUBTITLES_BASE || 'https://api.opensubtitles.com/api/v1',
  subdlBase: env.SUBDL_BASE || 'https://api.subdl.com/api/v1',
  subdlFiles: env.SUBDL_FILES || 'https://dl.subdl.com',
  comicCacheGB: +(env.COMIC_CACHE_GB || 4), // room for unpacked CBR/CB7 comics; the ones read longest ago are cleared first
  version: '0.1.0',
};

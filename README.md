# HallFlix

A self-hosted media service with its own server, web app and design Studio. It runs in Docker and does not need Jellyfin.

- **Fast playback:** files play as-is when the device can handle them; otherwise they are repackaged or converted on the fly.
- **Pre-rolls:** rules and schedules decide which clips play before which titles, the same on every device: seasonal presets, a cinema line-up,
  clips matched by genre, a shuffle where every clip gets a turn, a once-per-hour limit, a test tool, a health check and backups.
- **The Studio** (`/studio`): themes with live preview, a background and logo per library, seasons that switch on by date,
  pre-roll rules, profiles and plugins, plus:
  - **Artwork:** posters, backdrops, logos and thumbs for every title from an upload, a web link, the NAS or TMDb; drag, drop or paste;
    fill missing art in bulk; library tile pictures; a screensaver gallery.
  - **Metadata:** find titles across every library and edit many at once, with a preview, locks that survive rescans, a genre/tag/studio
    manager, CSV export and import, and undo.
  - **Parental controls:** rule sets that hide titles from chosen profiles by tag, genre or rating, enforced by the server in every app.
- **Movies and shows:** each library opens on **For you** (a spotlight, Continue watching, new, a Top 10, unwatched picks, under 100
  minutes, decades and genres) or **Browse all** (watched / unwatched / in progress, decade, age rating, A–Z jump, sorts by date, rating and
  length, and three card sizes). Title pages show 4K/HDR/5.1/CC badges, time left on the Play button, the cast, and tabs for Episodes (season
  pills, Up next, air dates, mark a season watched), More like this and Details (release, studio, languages, picture and sound, links out).
  - **Ratings:** IMDb, Rotten Tomatoes and its Popcornmeter, Metacritic, Letterboxd, Trakt and TMDb on each title, and a badge on cards. TMDb is
    built in; OMDb and MDBList take a free key; any JSON ratings API can be added in **Studio → Ratings**, and plugins can add services.
  - **Subtitles:** "Find subtitles online" in the player searches OpenSubtitles, SubDL, your own JSON services and plugin services, ranked by your
    languages and how well each fits the exact file; HallFlix can also fetch them by itself. Subtitle size, look (outline, dark box, yellow) and
    timing can be changed while watching, and the language you pick is remembered.
- **Music:** a Listen now page (quick tiles, jump back in, new albums, your top songs, genre mixes, artists, rediscover), song,
  artist and genre radio, Liked songs, a queue you can reorder (play next, add to queue, drag to move), volume and a sleep timer.
  Now Playing takes its colours from the album art and has time-synced lyrics that sweep across each line (word by word with
  enhanced LRC), full-screen lyrics, timing adjustment, and "Not right?" to search for or paste other lyrics.
  - **Lyrics services:** files on the NAS first, then LRCLIB (built in), any JSON lyrics API added in **Studio → Lyrics**, and
    services from plugins, in the order you set. What they find is kept, and can be saved beside the songs as .lrc files.
- **Books and comics:** an EPUB and PDF reader, and a comics section built like the big comic apps:
  - **Comic reader:** one page, two-page spreads (cover alone, double-page art on its own, spine shadow), a vertical scroll for webtoons (picked
    automatically for tall pages), and panel by panel; manga order; zoom (double-tap, pinch, + and −); a thumbnail strip and page grid; jump back;
    time left; brightness, background and night warmth; settings kept per series; previous and next issue.
  - **Fast CBR/CB7:** the archive type comes from the file itself (many "CBR" files are zips), RAR and 7z are unpacked once into a page cache in the
    background so page turns are instant, `unrar` and 7-Zip back up libarchive, and pages are sent at the size each screen needs.
  - **Comics library:** Continue reading and Up next, new issues, a row per publisher, unread badges and stacked series covers, and filters by
    read status, publisher and genre. Series pages show how far you've got, issues as covers or a list, and "mark read up to here".
- **Profiles:** pictures from an upload (drag, paste or the phone camera), ready-made characters or your library's artwork, framed with a cropper;
  everyone can edit their own name, colour, picture and password; admins see when each profile was last active and on how many devices, and can sign
  a profile out everywhere or clear its history.
- **Ways to browse:** a mood dial, Surprise Me, a timeline by decade, hand-made collections, voice search and a year in review.
- **Light, depth and sound** (Studio → Look and feel):
  - **Glow styles:** natural (soft light that falls off and is cast downward, coloured by each poster's artwork), the original sharp neon, or ambient
    (light only spills underneath); a crisp or travelling "aurora" outline for the title in focus; a slow aurora or film light leak behind the app;
    and a light that follows the pointer.
  - **3D library tiles:** like Apple TV's layered icons, the picture, covers and name move at different depths as a tile turns toward the pointer (or
    sways while it has the remote's focus), with a sliding sheen, a thick edge, and a tile video per library that plays while the tile is in focus.
  - **Sounds:** six packs (soft, arcade, cinema, glass, sci-fi, or only your own); every sound (moving, choosing, opening, going back, signing in,
    messages and the ident) can be tested, replaced with an upload, given its own volume or switched off.
  - **Sign-in music:** songs uploaded or picked from the music library play on the sign-in page, fade in, shuffle if you like, show their name on a
    small pause button, and fade out as someone signs in.
- **Tile backgrounds:** each library's Home tile can have its own picture or video, separate from the library page's background, or always
  show the library's newest artwork; you choose which part of the picture shows.
- **Home page sizes** (Studio → Look and feel → Home page): library tile width and height, the brightness of the tile pictures (each library can
  set its own), and the size of the film's logo on the banner.
- **Several idents:** upload as many as you like; they play shuffled (never the same one twice in a row) or in turn, optionally mixed with the
  built-in animation.
- **Library logos** (Studio → Look and feel): drag each library's logo (or name) to its own spot on a miniature of its Home tile, all tiles
  in one place under **Logo on each tile**, or use a 3×3 position grid and nudge sliders, resize it, hide the title count, and set the logo's height and place at the top of the library's own page (left, centre, right,
  the name instead, or hidden, nudged anywhere); for all libraries or one at a time.
- **Tidy rows** (Studio → Look and feel → Rows): limit how many titles each row shows (the last tile becomes “See all”), how many rows show
  before “Show more rows”, add a scroll bar under each row, or hold the rows in their own scrolling panel so the background stays in view. It applies
  to Home and every library, and each library can set its own.
- **Cinema touches:** a logo ident before the feature, scrub previews, skip intro, ambient glow and watch parties.
- **Plugins:** add themes, styles and features from a zip. See [docs/PLUGINS.md](docs/PLUGINS.md).

Install on a UGREEN NAS: [docker/INSTALL.md](docker/INSTALL.md).

## Layout

| Folder | What it is |
| --- | --- |
| `server/` | Node.js server and video converter, with tests |
| `web/` | The web app and the Studio |
| `docker/` | Compose file and install guide |
| `plugins-examples/` | A sample plugin |

## Developing

```
cd server && npm install
DATABASE_URL=postgres://user@localhost/hallflix_test npm test    # needs Postgres and ffmpeg
```

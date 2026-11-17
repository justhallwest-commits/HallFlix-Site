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
- **Books, comics and music:** an EPUB and PDF reader, a music player that keeps playing while you browse, and a comics section built like the big comic apps:
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

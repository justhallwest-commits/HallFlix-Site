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
- **Books, comics and music:** an EPUB and PDF reader, a comic reader with two-page spreads and manga order, and a music player that keeps playing while you browse.
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

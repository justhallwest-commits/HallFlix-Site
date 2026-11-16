# HallFlix

A self-hosted media service with its own server, web app and design Studio. It runs in Docker and does not need Jellyfin.

- **Fast playback:** files play as-is when the device can handle them; otherwise they are repackaged or converted on the fly.
- **Pre-rolls:** rules decide which clips play before which titles, the same on every device.
- **The Studio** (`/studio`): themes with live preview, a background and logo per library, seasons that switch on by date,
  pre-roll rules, profiles and plugins.
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

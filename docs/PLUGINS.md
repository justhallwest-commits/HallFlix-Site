# Making a HallFlix plugin

A plugin is a folder with a `plugin.json` and any CSS, JavaScript and themes it adds. Zip the folder and install it in
**Studio → Plugins → Install from .zip**. Nothing in HallFlix itself is edited, so plugins survive updates.

A working example is in [`plugins-examples/retro-arcade`](../plugins-examples/retro-arcade).

## plugin.json

```json
{
  "id": "retro-arcade",
  "name": "Retro Arcade",
  "version": "1.0.0",
  "description": "What it does",
  "contributes": {
    "css": ["style.css"],
    "js": ["main.js"],
    "themes": [{ "name": "Retro Arcade", "description": "…", "theme": { "colors": { "accent": "#ffe14d" } } }]
  }
}
```

- `id`: lowercase letters, numbers and dashes. It is also the folder name on the server.
- `css` and `js`: files loaded into the web app for every viewer while the plugin is on.
- `themes`: presets that appear in **Studio → Look and feel** and in the season editor.

## Themes

A theme lists only what it changes; everything else comes from the default.

| Key | Values |
| --- | --- |
| `colors` | `bg`, `surface`, `text`, `muted`, `accent`, `accent2` as `#rrggbb` |
| `fonts` | `display`, `body`: Outfit, Inter, Bebas Neue, Audiowide, Georgia, System |
| `radius` | card corner in pixels, 0 to 28 |
| `glow` | neon strength, 0 to 1 |
| `texture` | none, grain, scanlines, grid, vignette |
| `cardShape` | poster, wide |
| `heroHeight` | banner height, 40 to 100 (percent of the screen) |
| `effect` | none, snow, embers, hearts, leaves, confetti, stars, bats, or one a plugin registers |
| `background` | `{ image, dim, blur }` |
| `logo` | `{ image, height }` |

## CSS

Style with the theme's variables so your plugin follows the active look and seasons:
`--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--accent2`, `--radius`, `--glow`, `--font-display`, `--font-body`.

## JavaScript

Scripts get a global `HallFlix`:

| Call | What it does |
| --- | --- |
| `HallFlix.on(event, fn)` | Listen for `ready`, `route`, `look`, `player:start`, `player:ended`, `player:close` |
| `HallFlix.api(method, path, body)` | Call the HallFlix server as the signed-in profile |
| `HallFlix.addHomeRow({ id, title, position, load })` | Add a row to Home. `load()` returns a list of cards (for example from `/api/search`) |
| `HallFlix.registerEffect(name, { count, spawn, step, draw })` | Add a moving effect themes can use |
| `HallFlix.toast(text)` | Show a short message |
| `HallFlix.navigate(hash)` | Go to a page, such as `#/title/123` |
| `HallFlix.look`, `.profile`, `.libraries` | What is active right now |
| `HallFlix.html`, `HallFlix.raw` | Safe HTML templating: values in `` html`…` `` are escaped |

## Safety

Plugin code runs inside HallFlix for everyone who signs in, with that person's access. Only install plugins you trust.
Plugins currently reach the web app; the Android and Roku apps will read plugin themes but not run plugin scripts.

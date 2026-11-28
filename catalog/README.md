# The HallFlix online gallery

Studio → Theme gallery → **Online** reads `looks.json` from this folder (on GitHub's main branch) and offers each entry
to install in one click. Another catalog can be used instead (Studio → Theme gallery → Online → catalog address).

```json
{
  "entries": [
    { "id": "cinema-gold", "kind": "look", "name": "Cinema Gold", "author": "HallFlix", "description": "…",
      "url": "looks/cinema-gold.hallflix-look.json", "colors": { "bg": "#0b0906", "surface": "#1a150d", "accent": "#d9a441" } },
    { "id": "my-plugin", "kind": "plugin", "name": "…", "url": "https://github.com/me/my-plugin/archive/refs/heads/main.zip" },
    { "id": "tv-cards", "kind": "tv", "name": "…", "tvApp": { "rows": { "posterWidth": 140 } } }
  ]
}
```

- **look**: `url` points at a `.hallflix-look.json` (what Studio → Look and feel → Export makes). It's checked against the
  theme contract, then applied everywhere, on TVs only or on phones only, as the person installing chooses.
- **plugin**: `url` points at a plugin zip (with `plugin.json`), installed like Studio → Plugins → Install.
- **tv**: a Fire TV app layout, given inline as `tvApp` settings (see `docs/theme.schema.json`).
- `url` and `preview` may be relative to `looks.json`. `colors` (bg, surface, text, accent, accent2) draws the preview card.

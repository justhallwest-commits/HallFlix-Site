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

## Lyrics services

A plugin can add places to look for lyrics. HallFlix always tries the NAS first (a `.lrc` or `.txt` file beside the
song, or the song's tags), then the services in **Studio → Lyrics**, in the order set there. A service a plugin adds
appears in that list and can be turned off or moved like the others. Lyrics a service finds are kept, so each song is
asked for once.

### Described in plugin.json (runs on the server)

```json
"contributes": {
  "lyrics": [{
    "name": "Lyrics.ovh",
    "description": "Plain lyrics, no key needed",
    "url": "https://api.lyrics.ovh/v1/{artist}/{title}",
    "plain": "lyrics"
  }]
}
```

| Key | What it is |
| --- | --- |
| `url` | The address to ask. `{artist}`, `{title}`, `{album}` and `{duration}` (seconds) are filled in. |
| `synced` | Where time-synced LRC text sits in the JSON answer, as a dot path (`syncedLyrics`, `data.lrc`). |
| `plain` | Where plain lyrics sit (`plainLyrics`, `lyrics`). |
| `result` | Optional: the part of the answer that holds the fields above (`results.0`). |
| `searchUrl` | Optional: a search address with `{query}`, used by "Not right?" in Now Playing. |
| `searchList`, `searchTitle`, `searchArtist` | Optional: where the list of results, and each result's title and artist, sit. |
| `headers` | Optional: extra request headers, such as an API key. |

An answer that is plain text instead of JSON is read as lyrics (time-synced if it is LRC). A ready-to-zip example is in
[`plugins-examples/lyrics-ovh`](../plugins-examples/lyrics-ovh).

### In JavaScript (runs in the web app)

For services that need code, add a provider from a plugin script. It is asked only when nothing else found lyrics,
and what it returns is saved for everyone:

```js
HallFlix.addLyricsProvider({
  name: 'My service',
  async find({ title, artist, album, duration }) {
    const r = await fetch(`https://example.com/lyrics?q=${encodeURIComponent(`${artist} ${title}`)}`);
    if (!r.ok) return null;
    const j = await r.json();
    return { synced: j.lrc /* "[00:12.34] a line…" */, plain: j.text };
  },
});
```

`synced` can also be a list of `{ t, text }` (seconds). Enhanced LRC with a timestamp before each word
(`[00:12.00]<00:12.00>Hold <00:12.40>on`) lights up word by word.

## Ratings services

A plugin can add places to get ratings from. They appear in **Studio → Ratings** with the built-in ones (TMDb, OMDb,
MDBList) and are asked in the order set there; for each kind of rating (IMDb, Rotten Tomatoes, Letterboxd…) the first
service that has it wins. What's found is kept for two weeks.

```json
"contributes": {
  "ratings": [{
    "name": "My ratings",
    "url": "https://ratings.example.com/title/{imdb}",
    "list": "ratings",
    "source": "name",
    "value": "score"
  }]
}
```

| Key | What it is |
| --- | --- |
| `url` | The address to ask. `{imdb}` (tt1234567), `{tmdb}`, `{type}` (`movie` or `tv`), `{kind}` (`movie` or `show`), `{title}` and `{year}` are filled in. |
| `list` | Where a list of ratings sits in the JSON answer. Each needs a name and a score. |
| `source`, `value` | In each list entry: the field with the name (`IMDb`, `Rotten Tomatoes`, `Metacritic`, `Letterboxd`, `Trakt`… are recognised) and the score (`7.7`, `83%`, `67/100`). |
| `votes`, `link` | Optional: fields with the number of votes and a link to the page. |
| `value`, `label`, `max` | For a service that gives one score: leave `list` empty, point `value` at the score, give it a `label` and the best possible score in `max` (`10`, `5`, `100`). |
| `headers` | Optional: extra request headers, such as an API key. |

## Subtitle services

A plugin can add places to search for subtitles. They appear in **Studio → Subtitles** with OpenSubtitles and SubDL,
are searched from the player's "Find subtitles online", and can be used when HallFlix fetches subtitles by itself.

```json
"contributes": {
  "subtitles": [{
    "name": "My subtitles",
    "url": "https://subs.example.com/search?tmdb={tmdb}&s={season}&e={episode}&lang={lang}",
    "list": "results",
    "download": "file_url",
    "language": "lang",
    "release": "release_name"
  }]
}
```

| Key | What it is |
| --- | --- |
| `url` | The search address. `{tmdb}`, `{imdb}`, `{type}` (`movie` or `tv`), `{kind}` (`movie` or `episode`), `{title}`, `{year}`, `{season}`, `{episode}`, `{lang}` (like `en,es`), `{query}` and `{file}` (the video's file name) are filled in. For an episode, `{tmdb}` and `{imdb}` are the show's. |
| `list` | Where the list of results sits (empty if the answer is the list). |
| `download` | In each result: the field with the download address. It can be an `.srt`, `.ass` or `.vtt` file, or a `.zip` of them (for a season pack, the file named with the episode is picked). |
| `language`, `release` | In each result: the language code (`en`, `pt-br`) and the release name, used to rank the results against the video file. |
| `hi`, `downloads` | Optional: whether it is for deaf and hard of hearing viewers, and how many times it was downloaded. |
| `headers` | Optional: extra request headers, such as an API key. |

Files come back in whatever encoding they were made in (UTF-8, UTF-16, Windows-1252) and are converted to UTF-8.

### Music

`HallFlix.music` has `play(tracks, index, { source })`, `playNext(tracks)`, `addToQueue(tracks)`,
`startRadio('track:ID' | 'artist:ID' | 'album:ID' | 'genre:Name' | 'liked' | 'top' | 'all')`, `toggle()`, `next()`,
`prev()`, and `track`, `queue` and `playing` to read what is happening.

## Safety

Plugin code runs inside HallFlix for everyone who signs in, with that person's access. Only install plugins you trust.
Plugins currently reach the web app; the Android and Roku apps will read plugin themes but not run plugin scripts.

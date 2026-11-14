# Zarpa Party

Watch-together Chrome extension: synced play / pause / seek / speed plus a chat sidebar, between friends on streaming sites. Manifest V3, vanilla JS, no build step, no server code.

## ☕ Support / Apoie

[![Pix](https://img.shields.io/badge/Pix-Donate-32BCAD?logo=pix&logoColor=white)](#-support--apoie)

<img src="icons/pix-qr.png" width="240" alt="QR Code Pix">

- **pt-BR:** A Zarpa Party é grátis e sem anúncios. Curtiu? Pague um café pro dev via Pix (valor livre).
- **en:** Zarpa Party is free and ad-free. Enjoying it? Buy the dev a coffee via Pix (any amount).

Pix key: `contato@zarpadev.com.br`

Pix copia e cola:

```
00020126450014br.gov.bcb.pix0123contato@zarpadev.com.br5204000053039865802BR5911KAUA PESSIN6007VITORIA62070503***6304A70B
```

Regenerate payload and QR: `node scripts/make-pix.mjs` (see the header of the script).

## Features

- **One-click party**: "Criar Party" in the popup creates a room, joins it and copies the invite link. Opening the link with the extension installed joins automatically. A code or link can also be pasted in the popup.
- **Sync** of play, pause, seek and playback rate. Leader-less, last-writer-wins, with echo suppression, state hand-off to newcomers and periodic drift correction (small gaps are closed with a brief playback-rate nudge, large ones with a seek).
- **"Only the host controls"** toggle. The host is the longest-standing member.
- **Chat sidebar** in a closed Shadow DOM: editable nicknames, coloured avatars, system messages ("Ana pausou em 12:34"), floating emoji reactions, participant list, unread badge, collapse/expand, fullscreen support, keyboard shortcut (`Alt+Shift+Z`, editable in `chrome://extensions/shortcuts`).
- **Resilient**: auto-reconnect with exponential backoff, connection indicator, clean leave on tab close.
- Portuguese (Brazil) and English UI.

## Supported sites

Netflix, YouTube, Prime Video (`primevideo.com`, `amazon.com/gp/video`), Disney+, Max (`max.com`, `play.max.com`, `hbomax.com`), Crunchyroll, Globoplay, Paramount+, Apple TV+ (`tv.apple.com`), Twitch, Vimeo.

Any other site with an HTML5 `<video>`: open the popup and click **Ativar neste site / Enable on this site**. Chrome asks permission for that one origin; the choice is remembered.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and pick this folder (the one with `manifest.json`).

## Usage

1. Open a video on a supported site.
2. Click the extension icon, then **Criar Party**. The invite link is on your clipboard.
3. Friends open the link (they need the extension and their own account on the streaming service).
4. Chat in the sidebar; any play / pause / seek is mirrored for everyone.

## Architecture

```
manifest.json            MV3 manifest
config.js                Supabase URL + publishable key (the only place)
background.js            service worker: frame relay, shortcut, badge, injection on user-enabled sites
content/core.js          pure logic (room codes, LWW, drift, echo suppression, validation) - unit tested
content/realtime.js      Supabase Realtime client (Phoenix channel protocol over WebSocket)
content/player.js        main-video detection + uniform player API
content/netflix-main.js  MAIN-world bridge to Netflix's player API
content/ui.js            chat sidebar (Shadow DOM)
content/main.js          session orchestration
popup/                   popup UI
_locales/                pt_BR (default), en
scripts/                 make-icons.mjs, check.mjs, pack.ps1
tests/                   sync.test.mjs, realtime-smoke.mjs, test-page.html, harness.html
store/                   promo tile
```

- **Transport**: Supabase Realtime Broadcast + Presence on channel `zarpa-party:<roomCode>`. No tables, nothing persisted. `content/realtime.js` speaks the Phoenix protocol directly (about 200 lines) instead of bundling supabase-js, so there is **no vendored or remote code**.
- **Where things run**: the top frame of the tab owns the party (socket, sync decisions, sidebar). Content scripts run in all frames; the frame holding the largest ready `<video>` becomes the driver, and child frames are driven through the service worker relay.
- **Sync model**: every action carries the full state `{type, time, playing, rate, sentAt, senderId, seq}`. `seq` is a Lamport counter, so ordering never depends on wall clocks; ties break on `senderId`. Peer clock offsets are measured with a ping/pong and only used to age messages. The host broadcasts a heartbeat every 5 s while playing; everyone else corrects against it: under 0.5 s nothing, up to 2 s a 10 % rate nudge, beyond that a seek.
- **Echo suppression**: a local player event is broadcast only if it moved the player away from the shared state; events fired within 800 ms of applying a remote command are ignored.
- **Netflix**: writing `video.currentTime` crashes its player (M7375), so seek/play/pause go through `netflix.appContext.state.playerApp.getAPI().videoPlayer` in the MAIN world, reached by a validated `window.postMessage`.
- **Room codes**: 10 characters from a 31-symbol alphabet without `I L O 0 1`, drawn with `crypto.getRandomValues` (about 8e14 combinations).

## Development

Requires Node 22+ (only for the checks; the extension has no dependencies).

```
node tests/sync.test.mjs        # unit tests for the pure sync logic
node scripts/check.mjs          # manifest, referenced files, locales, node --check on every JS file
node tests/realtime-smoke.mjs   # real network: two clients on one room (add --fallback for the legacy key)
node scripts/make-icons.mjs     # regenerate icons/ and store/promo-440x280.png
```

Manual test: serve `tests/` over HTTP (`npx http-server tests -p 8080`), open `http://localhost:8080/test-page.html` in two windows, click **Enable on this site** in the popup, create a party in one window and open the invite link in the other.

`tests/harness.html` runs the real content scripts against a fake `chrome.*` API, to exercise the sidebar and sync in a plain tab without installing the extension (serve the repo root and open `/tests/harness.html`).

Set `debug: true` in `config.js` for verbose `console.debug` logging.

## Changing the Supabase project

Edit `config.js`: `url`, `key` (publishable key) and `fallbackKey` (legacy anon JWT, optional). Nothing else references the backend.

The project needs no tables or policies, but **Realtime must accept public channels**: in the Supabase dashboard, Realtime settings, keep "Allow public access" enabled (channels are joined with `private: false`). Mind the plan limits: concurrent connections (one per party member) and messages per month (a two-person, two-hour film costs roughly 3,000 heartbeat messages plus chat).

## Publishing to the Chrome Web Store

1. Bump `version` in `manifest.json`.
2. `node scripts/check.mjs && node tests/sync.test.mjs`
3. `powershell -ExecutionPolicy Bypass -File scripts/pack.ps1` creates `dist/zarpa-party-<version>.zip`.
4. In the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) create a new item and upload the zip.
5. Fill the listing from `STORE_LISTING.md` (descriptions, category, single purpose, permission justifications), upload at least one 1280x800 screenshot and `store/promo-440x280.png`.
6. Privacy tab: host `PRIVACY.md` at a public URL and paste the link; declare the data use as described there.
7. Submit for review.

## License

MIT, see `LICENSE`. Not affiliated with Netflix, YouTube, Amazon, Disney, Warner Bros. Discovery, Crunchyroll, Globo, Paramount, Apple, Twitch, Vimeo or Teleparty.

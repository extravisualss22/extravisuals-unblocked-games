# travis.suda — website and offline HTML

The website runs the full Stockfish 19 neural-network engine on your device. It needs no Chrome extension, Developer mode, account, API key, or backend.

## Open on a Chromebook

**If the full engine times out during startup, use [the Chromebook edition](downloads/travis.suda-chromebook.zip).** Extract it, close older app tabs, and open `travis.suda-chromebook.html`. It includes Stockfish 19 Lite offline, uses 32 MB hash memory instead of 128 MB, and allows up to three minutes for startup. The smaller network is weaker than the full version. It does not need an engine download. Build it with `npm run build:chromebook`.


**If the online version says `Failed to fetch`, download [travis.suda-offline.zip](downloads/travis.suda-offline.zip).** Extract it and open `travis.suda-offline.html` in Chrome, closing the old online page. This ZIP includes the full Stockfish engine and makes no engine download requests. It is approximately 85 MB compressed. Browser permission is still required for optional screen sharing.

If the large attachment will not download, use **travis.suda-online.html** (about 181 KB), or extract it from **travis.suda-small.zip**. This version downloads the same full Stockfish 19 engine from the pinned official npm package on first analysis; it does not use a weaker engine. The package transfer is about 154 MB, so first analysis can take several minutes and requires access to `registry.npmjs.org`. The selected WASM is checked against its SHA-256 before execution. The engine is reused while the page stays open. Game positions and video remain local. Build this version with `npm run build:online`.

Download **travis.suda.html**, keep it in Downloads, and open it in Chrome. It is a single self-contained page with its engine inside. The file is about 127 MB because it contains the full engine rather than a smaller, weaker network. Initial engine startup can take several seconds.

Use **Load position** to import a Chess.com FEN or complete PGN. You can also enter moves on the analysis board by selecting the starting and destination squares. Choose the promotion piece when prompted. Stockfish updates after each move, showing its recommendation, an arrow, evaluation, search depth, and continuation. Evaluation is from White's perspective. A longer think time generally searches deeper.

The downloaded page does not upload positions or screen captures. It requires no network requests for engine calculation after download.

## Optional screen sharing

If Chrome and your district allow screen sharing, choose **Share chess tab** and select the Chess.com tab yourself. Mark the board's two corners in the preview, set its orientation, and ensure the analysis position matches the shared board before starting tracking. Import the current FEN/PGN if the game has already started.

Screen sharing assists move entry; it does not silently guess the full position. When a stable change corresponds to one legal move, the page proposes that move for you to confirm. Selection highlights, animations, unusual themes, resizing, promotions, and missed moves can require entering the move manually and matching the position again. It cannot establish castling rights or en passant from a screenshot alone. Keep the companion visible beside Chess.com so browser background throttling does not delay updates.

If screen sharing is unavailable or blocked, manual move entry and FEN/PGN analysis still work. This page cannot override a district browser policy.

## Hosted website

`chess-website.zip` contains a normal static website with `index.html` at its root. Extract its contents onto an HTTPS static host. Serve JavaScript as `text/javascript` and WASM as `application/wasm`. No special isolation headers are required because the full single-thread engine is used. Screen sharing requires a browser-supported secure context and user permission. No hosted website is published by the build command.

## Build

From the repository root with a current Node.js and Python 3:

```sh
npm ci --ignore-scripts
npm run vendor
node scripts/build-web.mjs
node tests/standalone.mjs
```

The standalone test requires Playwright plus Chromium, available in the development environment. Set `CHROMIUM_PATH` if Chromium is installed elsewhere. By default the test opens the generated HTML directly from disk. This cloud browser blocks `file:` URLs by administrator policy; here, run `TEST_OVER_HTTP=1 node tests/standalone.mjs` to serve the exact self-contained HTML over a local HTTP server. This mode passed with the actual full engine, a forced mate, legal move entry, promotion, simulated tab capture with confirmation, stream cleanup, and responsive layout. There were no network requests after the page loaded. Direct file opening on a Chromebook and an actual Chess.com screen-share session remain unverified.

## Engine and source

Stockfish.js **19.0.1**, full single-thread WebAssembly build, full neural network, maximum skill, strength limiting off, 128 MB hash. Engine speed depends on Chromebook hardware and selected time. The app does not claim to match a dedicated multi-core analysis workstation.

Stockfish.js is GPL-3.0; chess.js 1.4.0 is BSD-2-Clause. Their license texts are included in `vendor/` in the hosted bundle and under **Licenses and source code** in the standalone HTML. Exact upstream sources:

- https://github.com/nmrugg/stockfish.js/tree/v19.0.1
- https://github.com/jhlywa/chess.js/tree/v1.4.0

The companion JavaScript is included unminified. No third-party engine binary is modified.

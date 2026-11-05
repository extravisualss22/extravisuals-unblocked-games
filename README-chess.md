# Build and test Chess Companion

The existing Game Shelf site is unchanged. The Chess.com Chrome extension is in `chess-assistant/`; user installation instructions are in `chess-assistant/README.md`.

```sh
npm ci --ignore-scripts
npm run vendor
npm test
npm run package
```

`npm run vendor` copies the pinned full Stockfish engine, chess.js, and licenses into an ignored vendor directory. The engine package is large (all official variants are present in node_modules); the extension includes only the full single-thread variant. `dist/chess-companion.zip` is a self-contained extension; users do not need npm or a server.

Browser tests require Playwright and Chromium. This cloud environment already provides them. Outside it, install Playwright and its Chromium browser, or supply `CHROMIUM_PATH` pointing to a local Chromium installation as supported by the test. Tests use local fixtures and the real packaged engine; they do not log into Chess.com.

Never commit the generated vendor binaries or node_modules. The lockfile pins packages and their integrity hashes.

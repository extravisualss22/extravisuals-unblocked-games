# Chess Companion for Chrome / Chromebook

A Chrome side panel that reads the visible Chess.com board and recommends moves with the full Stockfish 19 neural-network engine. It updates as the board changes, displays an arrow, SAN move, White-perspective evaluation, search depth, and continuation. All engine calculation happens on your device. No account, API key, backend, or hosted website is needed.

## Install on your Chromebook

1. Download `chess-companion.zip` and extract the entire `chess-companion` folder in the Files app. Keep the extracted folder; Chrome loads its files directly.
2. In Chrome, open `chrome://extensions` and turn on **Developer mode** (the switch on that page; ChromeOS developer mode is not required).
3. Choose **Load unpacked** and select the extracted folder that contains `manifest.json`.
4. Open or refresh your Chess.com game. Pin Chess Companion from Chrome’s Extensions menu, then click its icon to open the side panel.
5. Keep **Follow Chess.com** enabled. The panel automatically reads the board and analyzes each verified position. Adjust **Think time** for a deeper search.

The extension is not published in the Chrome Web Store. If your Chromebook is managed and Load unpacked is disabled, its administrator must permit this installation method.

## Using it

- A complete readable move history lets the extension synchronize a game already in progress. If the history cannot be read, it can start tracking from the initial position, or from an imported FEN/PGN.
- If the panel asks for a position, copy the FEN or PGN using Chess.com’s share/download controls, open **Import a position or game**, paste it, and select **Load position**. Then enable **Follow Chess.com** to track subsequent moves. Import the current game, not a different position.
- The arrow and move recommendation update while Stockfish searches. Evaluation is from White’s perspective; `+` favors White, `−` favors Black, and `M` indicates a forced mate according to the search. A longer think time generally searches deeper.
- **Stop** halts the current analysis. **Analyze** starts it again. A changed position starts a new search automatically.
- The extension reads the page and displays advice. It does not play moves, submit clicks, read account credentials, or transmit game positions to a service.

## Engine and compatibility

Stockfish.js **19.0.1**, full single-thread WebAssembly build with its full neural network, maximum skill, strength limiting off, and 128 MB hash. This is the full engine rather than the weaker “lite” network. One CPU thread is used for broad Chromebook compatibility. Speed and search depth depend on the device and time limit; no claim of a globally strongest hardware configuration is made. The engine is approximately 94 MB before ZIP compression. Initial loading can take several seconds.

Use a current Chrome with side-panel support (Chrome 114+). The extension supports standard chess on Chess.com; variants and multiple equally prominent boards are not supported. Page layout changes can require updates to `content.js`. Position verification is deliberately conservative: castling rights, en passant, and side to move are never inferred from piece locations alone. It catches up by up to two legal plies when move history is unavailable. If more moves are missed, import the current FEN/PGN again. Full PGN preserves repetition history; a standalone FEN cannot encode earlier repetitions.

The real engine and panel are tested in Chromium with the extension’s content-security policy, including simulated Chess.com DOM/message flows. This cloud browser’s administrator policy blocks unpacked extension installation, so extension installation and an authenticated live Chess.com match could not be verified here. Your Chromebook installation remains to be checked.

## License / source

This companion is distributed under GPL-3.0-only; see `vendor/stockfish-LICENSE.txt`. Stockfish.js is GPL-3.0; chess.js 1.4.0 is BSD-2-Clause, included in `vendor/chess-LICENSE.txt`.

- Exact Stockfish.js source: https://github.com/nmrugg/stockfish.js/tree/v19.0.1
- Stockfish.js build instructions and source archive: https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1
- chess.js source: https://github.com/jhlywa/chess.js/tree/v1.4.0

All companion JavaScript, CSS, HTML, and its manifest are included unminified in this folder. Engine files are copied unchanged from the pinned npm package; no network code is downloaded at runtime.

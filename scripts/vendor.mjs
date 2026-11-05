import { copyFile, mkdir } from 'node:fs/promises';
const dest = new URL('../chess-assistant/vendor/', import.meta.url);
await mkdir(dest, { recursive: true });
for (const file of ['stockfish-19-single.js', 'stockfish-19-single.wasm']) {
  await copyFile(new URL(`../node_modules/stockfish/bin/${file}`, import.meta.url), new URL(file, dest));
}
await copyFile(new URL('../node_modules/chess.js/dist/esm/chess.js', import.meta.url), new URL('chess.js', dest));
await copyFile(new URL('../node_modules/chess.js/LICENSE', import.meta.url), new URL('chess-LICENSE.txt', dest));
await copyFile(new URL('../node_modules/stockfish/Copying.txt', import.meta.url), new URL('stockfish-LICENSE.txt', dest));
console.log('Copied full Stockfish 19 single-thread engine, chess.js, and licenses.');

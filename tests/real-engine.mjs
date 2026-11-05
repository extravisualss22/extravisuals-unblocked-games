// Integration check using bundled WASM and the exact extension script CSP.
// This machine's managed Chromium blocks unpacked extensions, so this serves
// the same files locally; actual extension installation is a separate check.
// Run: node tests/real-engine.mjs (Chromium must be allowed to launch).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const extension = resolve('chess-assistant');
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
const server = createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', manifest.content_security_policy.extension_pages);
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Local Stockfish engine test</title>');
      return;
    }
    const file = resolve(extension, `.${decodeURIComponent(path)}`);
    if (!file.startsWith(extension + sep)) throw new Error('Invalid path');
    const data = await readFile(file);
    response.setHeader('Content-Type', { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' }[extname(file)] || 'application/octet-stream');
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const { Engine } = await import('./engine.js');
    const { Chess } = await import('./vendor/chess.js');
    const infos = [], completions = [], errors = [];
    let resolveResult, rejectResult;
    const engine = new Engine({
      onInfo: info => infos.push(info),
      onBestMove: result => { completions.push(result); resolveResult?.(result); },
      onError: error => { errors.push(error.message); rejectResult?.(error); },
    });
    function completion() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Analysis timed out')), 25000);
        resolveResult = result => { clearTimeout(timer); resolve(result); };
        rejectResult = error => { clearTimeout(timer); reject(error); };
      });
    }
    async function untilThinking() {
      const end = Date.now() + 5000;
      while (engine.state !== 'thinking') {
        if (Date.now() > end) throw new Error('Search never started');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    try {
      await engine.start();
      engine.analyze({ fen: new Chess().fen(), timeMs: 5000 });
      await untilThinking();
      engine.analyze({ fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', timeMs: 5000 });
      const mateFen = '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1';
      const completed = completion();
      const latestToken = engine.analyze({ fen: mateFen, timeMs: 1000 });
      const best = await completed;
      const board = new Chess(mateFen);
      board.move({ from: best.move.slice(0, 2), to: best.move.slice(2, 4), promotion: best.move[4] });
      const isMate = board.isCheckmate();
      const terminalCompleted = completion();
      engine.analyze({ fen: board.fen(), timeMs: 250 });
      const terminal = await terminalCompleted;
      return {
        latestToken, best, isMate, terminalMove: terminal.move,
        completionCount: completions.length, infoCount: infos.length, errors,
      };
    } finally { engine.dispose(); }
  });
  assert.equal(result.best.token, result.latestToken, 'Only the latest queued search may complete');
  assert.equal(result.best.score.type, 'mate');
  assert.equal(result.isMate, true, 'The recommended move must deliver actual checkmate');
  assert.equal(result.terminalMove, null, 'A checkmated position has no legal move');
  assert.equal(result.completionCount, 2, 'Canceled searches must not emit completions');
  assert.ok(result.infoCount > 0, 'The actual engine must stream analysis');
  assert.deepEqual(result.errors, []);
  console.log(JSON.stringify({ passed: true, engine: 'Stockfish 19 full single-thread', ...result }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

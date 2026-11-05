import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../chess-assistant/vendor/chess.js';
import { boardFeatures, changedSquares, candidateMoves } from '../chess-assistant/capture.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

function syntheticBoard(pieces = [], highlighted = []) {
  const width = 320, data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor(y / 40), column = Math.floor(x / 40);
    const square = String.fromCharCode(97 + column) + (8 - row);
    const fill = highlighted.includes(square) ? 160 : (row + column) % 2 ? 100 : 220;
    const piece = pieces.includes(square) && x % 40 > 12 && x % 40 < 28 && y % 40 > 9 && y % 40 < 31;
    const value = piece ? 0 : fill;
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  return { width, height: width, data };
}

test('square features ignore flat highlights and identify stable piece movement in either orientation', () => {
  const before = boardFeatures(syntheticBoard(['e2']));
  assert.deepEqual(changedSquares(before, boardFeatures(syntheticBoard(['e2'], ['e2', 'e4']))), []);
  assert.deepEqual(changedSquares(before, boardFeatures(syntheticBoard(['e4']))), ['e2', 'e4']);
  const flippedBefore = boardFeatures(syntheticBoard(['e2']), 'black');
  const flippedAfter = boardFeatures(syntheticBoard(['e4']), 'black');
  assert.deepEqual(changedSquares(flippedBefore, flippedAfter), ['d5', 'd7']);
});

test('changed square matching only proposes legal moves and preserves game state', () => {
  const game = new Chess();
  const initial = game.fen();
  assert.deepEqual(candidateMoves(game, ['e4', 'e2']), [{ from:'e2', to:'e4', san:'e4' }]);
  assert.deepEqual(candidateMoves(game, ['e2', 'e5']), []);
  assert.deepEqual(candidateMoves(game, ['e2']), []);
  assert.equal(game.fen(), initial);
});

test('castling and en passant account for every changed square', () => {
  const castle = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.deepEqual(candidateMoves(castle, ['e1', 'g1', 'h1', 'f1']), [{ from:'e1', to:'g1', san:'O-O' }]);
  assert.deepEqual(candidateMoves(castle, ['e1', 'g1']), []);
  const ep = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  assert.deepEqual(candidateMoves(ep, ['e5', 'd5', 'd6']), [{ from:'e5', to:'d6', san:'exd6' }]);
});

test('promotion remains ambiguous and requires a manual choice', () => {
  const game = new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1');
  const candidates = candidateMoves(game, ['a7', 'a8']);
  assert.equal(candidates.length, 4);
  assert.deepEqual(candidates.map(move => move.promotion).sort(), ['b','n','q','r']);
});

test('capture pipeline requires confirmation, rejects stale capture, stops media, and handles denied sharing', { timeout: 30000 }, async () => {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const server = createServer(async (req, res) => {
    if (req.url === '/') { res.setHeader('content-type','text/html'); res.end('<video id="video" hidden></video><canvas id="preview" style="width:320px;height:320px"></canvas>'); return; }
    try {
      const root = resolve('chess-assistant');
      const path = resolve(root, '.' + req.url);
      if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
      const body = await readFile(path);
      res.setHeader('content-type','text/javascript'); res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true, args:['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const { BoardCapture } = await import('/capture.js');
      const { Chess } = await import('/vendor/chess.js');
      window.source = document.createElement('canvas'); source.width = source.height = 320;
      window.paint = pieces => {
        const ctx = source.getContext('2d');
        for (let row=0;row<8;row++) for(let col=0;col<8;col++) {
          ctx.fillStyle=(row+col)%2 ? '#666' : '#ddd'; ctx.fillRect(col*40,row*40,40,40);
          const square=String.fromCharCode(97+col)+(8-row);
          if(pieces.includes(square)){ctx.fillStyle='#000';ctx.fillRect(col*40+13,row*40+10,15,21);}
        }
      };
      paint(['e2','e7']);
      navigator.mediaDevices.getDisplayMedia = async () => { window.stream=source.captureStream(10); return stream; };
      window.states=[];window.candidates=[];window.game=new Chess();
      window.capture=new BoardCapture({video:document.querySelector('video'),canvas:document.querySelector('canvas'),onState:state=>states.push(state),onCandidate:candidate=>candidates.push(candidate)});
      await capture.start();
    });
    await page.locator('#preview').click({position:{x:1,y:1}});
    await page.locator('#preview').click({position:{x:319,y:319}});
    await page.evaluate(() => capture.seed(game));
    await page.evaluate(() => paint(['e4','e7']));
    await page.waitForFunction(() => candidates.length === 1);
    assert.equal(await page.evaluate(() => candidates[0].move.san),'e4');
    assert.equal(await page.evaluate(() => game.history().length),0,'Capture never commits moves');
    assert.equal(await page.evaluate(() => capture.tracking),false);
    await page.evaluate(() => paint(['e4','e5']));
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => { game.move('e4'); return capture.acknowledge(game); }),false,'A second move before confirmation requires resync');
    assert.match(await page.evaluate(() => states.at(-1).message),/changed again/);
    await page.evaluate(() => capture.stop());
    assert.equal(await page.evaluate(() => stream.getTracks()[0].readyState),'ended');
    assert.equal(await page.evaluate(() => capture.stream),null);
    await page.evaluate(async () => {
      navigator.mediaDevices.getDisplayMedia=async()=>{throw new DOMException('blocked','NotAllowedError');};
      await capture.start();
    });
    assert.equal(await page.evaluate(() => states.at(-1).state),'error');
    assert.match(await page.evaluate(() => states.at(-1).message),/canceled or blocked/);
    await page.evaluate(() => capture.dispose());
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
});

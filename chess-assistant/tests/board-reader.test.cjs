const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const initial = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
function pieces(placement = initial) {
  return placement.split('/').flatMap((row, index) => {
    let file = 0;
    return [...row].flatMap(piece => {
      if (/\d/.test(piece)) { file += Number(piece); return []; }
      file++;
      return `<div class="piece ${piece === piece.toUpperCase() ? 'w' : 'b'}${piece.toLowerCase()} square-${file}${8 - index}"></div>`;
    });
  }).join('');
}

test('Chess.com DOM reading: squares, turns, histories, ambiguous and hidden boards', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>wc-chess-board,chess-board,.board { display:block;width:320px;height:320px }.piece{display:block;width:30px;height:30px;position:absolute}vertical-move-list{display:block}</style><wc-chess-board id="board-single">${pieces()}</wc-chess-board>`);
    await page.addScriptTag({ path: path.join(__dirname, '../content.js') });
    let result = await page.evaluate(() => ChessBoardReader.readPosition());
    assert.equal(result.ok, true);
    assert.equal(result.placement, initial);
    assert.equal(result.turn, null);
    assert.equal(result.orientation, 'white');
    assert.equal('fen' in result, false);

    await page.evaluate(() => {
      document.querySelector('wc-chess-board').setAttribute('data-turn', 'black');
      document.body.insertAdjacentHTML('beforeend', '<vertical-move-list><div class="move"><span class="node white">1. e4</span><span class="node black">e5</span></div><div class="move"><span class="node white"><span class="icon" data-figurine="N"></span>f3<span class="evaluation">+0.2</span></span></div></vertical-move-list>');
    });
    result = await page.evaluate(() => ChessBoardReader.readPosition());
    assert.equal(result.turn, 'b');
    assert.deepEqual(result.moveHistory, ['e4', 'e5', 'Nf3']);

    await page.evaluate(() => {
      const board = document.querySelector('wc-chess-board');
      board.removeAttribute('data-turn');
      board.classList.add('flipped');
      document.body.insertAdjacentHTML('beforeend', '<div class="clock-player-turn clock-bottom">05:00</div>');
    });
    result = await page.evaluate(() => ChessBoardReader.readPosition());
    assert.equal(result.turn, 'b');
    assert.equal(result.orientation, 'black');

    await page.evaluate(() => {
      const duplicate = document.querySelector('wc-chess-board').cloneNode(true);
      duplicate.id = 'hidden-preview'; duplicate.style.display = 'none';
      document.body.append(duplicate);
    });
    assert.equal((await page.evaluate(() => ChessBoardReader.readPosition())).ok, true);
    await page.evaluate(() => {
      document.querySelector('#hidden-preview').style.display = 'block';
      document.querySelector('#board-single').id = 'first-board';
    });
    result = await page.evaluate(() => ChessBoardReader.readPosition());
    assert.equal(result.ok, false);
    assert.match(result.error, /More than one/);

    await page.evaluate(() => {
      document.querySelector('#hidden-preview').remove();
      document.querySelector('wc-chess-board').insertAdjacentHTML('beforeend', '<div class="piece wp square-11"></div>');
    });
    result = await page.evaluate(() => ChessBoardReader.readPosition());
    assert.equal(result.ok, false);
    assert.match(result.error, /moving or.*ambiguous/);
  } finally { await browser.close(); }
});

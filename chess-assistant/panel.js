import { Chess } from './vendor/chess.js';
import { Engine } from './engine.js';
import { resolveSnapshot, importPosition, analysisPosition, moveDetails, variation } from './position.js';

const $ = id => document.getElementById(id);
const glyphs = { k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' };
const names = { k:'King', q:'Queen', r:'Rook', b:'Bishop', n:'Knight', p:'Pawn' };
let game = null;
let orientation = 'white';
let activeToken = null;
let best = null;
let attachedTab = null;
let attachedGame = null;
let polling = false;
let stopped = false;
let revision = 0;
let importedSeed = false;
let manualOrientation = false;
let liveVerified = false;
let engineFailed = false;

const engine = new Engine({
  onStatus({ state, message }) {
    if (!stopped || state === 'error') $('engine-status').textContent = message;
  },
  onInfo(info) {
    if (info.token !== activeToken || !game) return;
    if (info.depth) $('depth').textContent = `Depth ${info.depth}`;
    if (info.score) {
      const value = info.score.value * (game.turn() === 'w' ? 1 : -1);
      $('evaluation').textContent = info.score.type === 'mate' ? `${value < 0 ? '−' : ''}M${Math.abs(value)}` : `${value > 0 ? '+' : ''}${(value / 100).toFixed(2)}`;
      $('evaluation').title = 'Evaluation from White’s perspective';
    }
    if (info.pv?.length) showMove(info.pv[0], info.pv);
  },
  onBestMove(info) {
    if (info.token !== activeToken || !game) return;
    showMove(info.move, info.pv);
    $('engine-status').textContent = 'Analysis complete';
  },
  onError(error) {
    engineFailed = true;
    activeToken = null;
    clearResult();
    notice(`Engine error: ${error.message}. Press Analyze to retry.`);
  },
});

function notice(text = '') {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

function clearResult() {
  best = null;
  $('best-move').textContent = '—';
  $('evaluation').textContent = '—';
  $('depth').textContent = 'Depth —';
  $('move-description').textContent = game ? 'Finding the strongest continuation' : 'Connect or import a position';
  $('variation').textContent = 'The engine’s continuation appears here.';
  $('arrow').setAttribute('hidden', '');
}

function boardCoordinates(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return orientation === 'white' ? [file * 100 + 50, (7 - rank) * 100 + 50] : [(7 - file) * 100 + 50, rank * 100 + 50];
}

function drawArrow() {
  $('arrow').toggleAttribute('hidden', !best);
  if (!best) return;
  const [x1, y1] = boardCoordinates(best.from);
  const [x2, y2] = boardCoordinates(best.to);
  const distance = Math.hypot(x2 - x1, y2 - y1);
  const shorten = 17 / distance;
  for (const [key, value] of Object.entries({ x1, y1, x2:x2-(x2-x1)*shorten, y2:y2-(y2-y1)*shorten })) $('best-arrow').setAttribute(key, value);
}

function renderBoard() {
  const current = game || new Chess();
  const board = $('board');
  board.replaceChildren();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = orientation === 'white' ? col : 7 - col;
      const rank = orientation === 'white' ? 8 - row : row + 1;
      const square = String.fromCharCode(97 + file) + rank;
      const piece = current.get(square);
      const cell = document.createElement('div');
      cell.className = `square ${(file + rank) % 2 === 0 ? 'dark' : ''}`;
      cell.dataset.square = square;
      cell.setAttribute('aria-label', `${square}${piece ? ` ${piece.color === 'w' ? 'White' : 'Black'} ${names[piece.type]}` : ''}`);
      if (piece) {
        const span = document.createElement('span');
        span.className = `piece ${piece.color === 'w' ? 'white' : 'black'}`;
        span.textContent = glyphs[piece.type];
        cell.append(span);
      }
      if (col === 0) { const label = document.createElement('span'); label.className = 'coordinate rank'; label.textContent = rank; cell.append(label); }
      if (row === 7) { const label = document.createElement('span'); label.className = 'coordinate file'; label.textContent = square[0]; cell.append(label); }
      board.append(cell);
    }
  }
  $('turn').textContent = game ? `${game.turn() === 'w' ? 'White' : 'Black'} to move` : 'Waiting for a position';
  drawArrow();
}

function showMove(uci, pv = []) {
  const move = moveDetails(game, uci);
  if (!move) {
    best = null;
    $('best-move').textContent = '—';
    $('move-description').textContent = 'No legal move available';
    drawArrow();
    return;
  }
  best = move;
  $('best-move').textContent = move.san;
  $('move-description').textContent = `${names[move.piece]} ${move.from} → ${move.to}${move.promotion ? ` · promote to ${names[move.promotion].toLowerCase()}` : ''}`;
  $('variation').textContent = variation(game, pv?.length ? pv : [uci]);
  drawArrow();
}

function analyze(explicit = false) {
  if ($('live').checked && !liveVerified) { notice('Sync your current board before analyzing, or pause live following to analyze the displayed position.'); return; }
  if (engineFailed && !explicit) return;
  if (explicit) engineFailed = false;
  if (!game) { notice('Connect to a Chess.com board or import a FEN / PGN first.'); return; }
  stopped = false;
  engine.stop();
  activeToken = null;
  clearResult();
  if (game.isGameOver()) {
    const result = game.isCheckmate() ? 'Checkmate' : game.isStalemate() ? 'Stalemate' : 'Draw';
    $('move-description').textContent = result;
    $('variation').textContent = 'This position is finished.';
    $('engine-status').textContent = 'Game over';
    return;
  }
  activeToken = engine.analyze({ ...analysisPosition(game), timeMs: Number($('time').value) });
}

function setGame(next, source) {
  const changed = !game || next.fen() !== game.fen() || JSON.stringify(next.history()) !== JSON.stringify(game.history());
  game = next;
  $('source').textContent = source;
  renderBoard();
  if (changed || activeToken === null && !stopped) analyze();
}

async function sync() {
  if (!$('live').checked || polling) return;
  if (!globalThis.chrome?.tabs) { notice('Open this as a Chrome extension to follow Chess.com. You can also import a position below.'); return; }
  polling = true;
  const epoch = revision;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (epoch !== revision || !$('live').checked) return;
    if (!tab?.id) throw new Error('Open your Chess.com game in the active tab.');
    if (attachedTab !== tab.id) {
      attachedTab = tab.id; attachedGame = null; manualOrientation = false;
      if (!importedSeed) { liveVerified = false; game = null; activeToken = null; engine.stop(); clearResult(); renderBoard(); }
      importedSeed = false;
    }
    const snapshot = await chrome.tabs.sendMessage(tab.id, { type:'READ_POSITION' });
    if (epoch !== revision || !$('live').checked) return;
    if (attachedGame && snapshot.gameKey && attachedGame !== snapshot.gameKey) { game = null; activeToken = null; engine.stop(); clearResult(); }
    attachedGame = snapshot.gameKey || attachedGame;
    const resolved = resolveSnapshot(snapshot, game);
    liveVerified = true;
    if (snapshot.orientation && !manualOrientation) orientation = snapshot.orientation;
    notice();
    $('connection').textContent = 'Following Chess.com';
    $('connection-dot').classList.add('connected');
    setGame(resolved.game, resolved.source);
  } catch (error) {
    if (epoch !== revision || !$('live').checked) return;
    liveVerified = false;
    activeToken = null;
    engine.stop();
    clearResult();
    $('move-description').textContent = 'Waiting for a verified position';
    $('engine-status').textContent = 'Board not synced';
    $('connection').textContent = 'Waiting for your board';
    $('connection-dot').classList.remove('connected');
    const noListener = /Receiving end|Could not establish|Cannot access|No tab/.test(error.message);
    notice(noListener ? 'Open Chess.com in this window and refresh its page once after installing the extension.' : error.message);
  } finally { polling = false; }
}

$('live').addEventListener('change', () => {
  revision++;
  if ($('live').checked) { liveVerified = false; stopped = false; activeToken = null; engine.stop(); clearResult(); sync(); }
  else { $('connection').textContent = 'Imported / paused position'; $('connection-dot').classList.remove('connected'); notice('Live following is paused. Analysis uses the position shown here.'); }
});
$('refresh').addEventListener('click', () => { revision++; $('live').checked = true; liveVerified = false; stopped = false; activeToken = null; engine.stop(); clearResult(); sync(); });
$('flip').addEventListener('click', () => { manualOrientation = true; orientation = orientation === 'white' ? 'black' : 'white'; renderBoard(); });
$('analyze').addEventListener('click', () => analyze(true));
$('stop').addEventListener('click', () => { stopped = true; activeToken = null; engine.stop(); $('engine-status').textContent = 'Analysis stopped'; });
$('time').addEventListener('change', () => { globalThis.chrome?.storage?.local.set({ thinkTime:$('time').value }); if (game) analyze(); });

function importGame(next, source) {
  revision++;
  $('live').checked = false;
  stopped = false;
  engineFailed = false;
  liveVerified = false;
  attachedTab = null;
  attachedGame = null;
  importedSeed = true;
  $('connection').textContent = 'Imported position';
  $('connection-dot').classList.remove('connected');
  $('import-error').textContent = '';
  notice('Analyzing your imported position. Turn on Follow Chess.com to track subsequent moves.');
  setGame(next, source);
}
$('import').addEventListener('click', () => {
  try { importGame(importPosition($('position-input').value), 'Imported FEN / PGN'); }
  catch (error) { $('import-error').textContent = error.message; }
});
$('start-position').addEventListener('click', () => importGame(new Chess(), 'Starting position'));
$('copy').addEventListener('click', async () => {
  if (!game) { $('import-error').textContent = 'No position to copy yet.'; return; }
  try { await navigator.clipboard.writeText(game.fen()); $('import-error').textContent = 'FEN copied.'; }
  catch { $('position-input').value = game.fen(); $('position-input').select(); $('import-error').textContent = 'Select and copy the FEN above.'; }
});

globalThis.chrome?.storage?.local.get('thinkTime').then(settings => {
  if (['1000','3000','10000','30000'].includes(settings.thinkTime)) $('time').value = settings.thinkTime;
});
window.addEventListener('pagehide', () => engine.dispose());
renderBoard();
clearResult();
sync();
setInterval(sync, 900);

/* Read-only Chess.com board adapter. Run in the extension's isolated world. */
(() => {
  'use strict';
  if (globalThis.ChessBoardReader) return;

  const BOARD_SELECTOR = 'wc-chess-board, chess-board, .board';
  const FILES = 'abcdefgh';
  const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const FIGURINES = { '♔': 'K', '♚': 'K', '♕': 'Q', '♛': 'Q', '♖': 'R', '♜': 'R', '♗': 'B', '♝': 'B', '♘': 'N', '♞': 'N', '♙': '', '♟': '' };

  function visible(element) {
    if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function pieceOn(element) {
    const classes = [...element.classList];
    const piece = classes.find(value => /^[wb][pnbrqk]$/.test(value));
    const square = classes.find(value => /^square-[1-8][1-8]$/.test(value));
    if (!piece || !square) return null;
    return { color: piece[0], type: piece[1], file: Number(square[7]), rank: Number(square[8]) };
  }

  function readPieces(board) {
    const squares = new Map();
    const pieces = [...board.querySelectorAll('.piece')].filter(visible).map(pieceOn).filter(Boolean);
    if (!pieces.length) throw new Error('The board has no readable pieces. Wait for it to finish loading.');
    for (const piece of pieces) {
      const square = FILES[piece.file - 1] + piece.rank;
      if (squares.has(square)) throw new Error('Pieces are moving or the board is ambiguous. Try again in a moment.');
      squares.set(square, piece);
    }
    if (pieces.length > 32 || ['w', 'b'].some(color => pieces.filter(piece => piece.type === 'k' && piece.color === color).length !== 1)) {
      throw new Error('The visible position needs exactly one king of each color.');
    }
    const rows = [];
    for (let rank = 8; rank >= 1; rank--) {
      let row = '', empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = squares.get(FILES[file] + rank);
        if (!piece) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  }

  function findBoard() {
    // A custom board can itself carry .board; ancestor wrappers must not be counted twice.
    let candidates = [...document.querySelectorAll(BOARD_SELECTOR)].filter(element => visible(element) && element.querySelector('.piece'));
    candidates = candidates.filter(element => !candidates.some(other => other !== element && element.contains(other)));
    candidates = candidates.map(element => ({ element, area: element.clientWidth * element.clientHeight }))
      .filter(({ area }) => area >= 2500).sort((a, b) => b.area - a.area);
    if (!candidates.length) throw new Error('No supported Chess.com board found. Open a game and wait for its board to load.');
    if (candidates.length > 1 && candidates[1].area >= candidates[0].area * 0.9) {
      const main = candidates.filter(({ element }) => element.id === 'board-single');
      if (main.length === 1) return main[0].element;
      throw new Error('More than one full-size board is visible. Open a page with a single game board.');
    }
    return candidates[0].element;
  }

  function orientationOf(board) {
    return board.classList.contains('flipped') || board.getAttribute('orientation') === 'black' || board.getAttribute('data-orientation') === 'black' ? 'black' : 'white';
  }

  function colorValue(value) {
    if (value === 'w' || value === 'white') return 'w';
    if (value === 'b' || value === 'black') return 'b';
    return null;
  }

  function readTurn(board) {
    for (const attribute of ['data-turn', 'turn', 'data-active-color', 'active-color']) {
      const turn = colorValue(board.getAttribute(attribute));
      if (turn) return { turn, turnSource: `board ${attribute}` };
    }
    const clocks = [...document.querySelectorAll('.clock-player-turn')].filter(visible);
    if (clocks.length === 1) {
      const clock = clocks[0];
      const color = colorValue(clock.getAttribute('data-color')) ||
        (clock.classList.contains('clock-white') ? 'w' : clock.classList.contains('clock-black') ? 'b' : null);
      if (color) return { turn: color, turnSource: 'active clock color' };
      // Chess.com's top/bottom clock classes are relative to the displayed board orientation.
      if (clock.classList.contains('clock-top') || clock.classList.contains('clock-bottom')) {
        const bottom = clock.classList.contains('clock-bottom');
        const whiteAtBottom = orientationOf(board) === 'white';
        return { turn: bottom === whiteAtBottom ? 'w' : 'b', turnSource: 'active clock and board orientation' };
      }
    }
    return { turn: null, turnSource: 'unknown' };
  }

  function sanFromNode(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('.annotation, .evaluation, .move-time, .time, .comment, .variation, .icon:not([data-figurine])').forEach(element => element.remove());
    // Chess.com often represents the piece letter as a data-figurine span, not text.
    copy.querySelectorAll('[data-figurine]').forEach(element => {
      const value = element.getAttribute('data-figurine');
      const match = value && value.toUpperCase().match(/^[WB]?([KQRBNP])$/);
      if (match) element.textContent = match[1] === 'P' ? '' : match[1];
    });
    let san = copy.textContent.trim().replace(/[♔♚♕♛♖♜♗♝♘♞♙♟]/g, character => FIGURINES[character]);
    san = san.replace(/^\d+\.(?:\.\.)?\s*/, '').replace(/\s*e\.?p\.?$/i, '').replace(/[!?]+/g, '').replace(/\s+/g, '').replace(/0/g, 'O');
    return /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?)[+#]?$/.test(san) ? san : null;
  }

  function readHistory() {
    const roots = [...document.querySelectorAll('wc-move-list, vertical-move-list, .vertical-move-list, .move-list, [data-cy="move-list"]')].filter(visible);
    const histories = [];
    for (const root of roots) {
      for (const selector of ['.node:not(.variation .node)', '.move-text-component', '.move .white, .move .black', '[data-ply]']) {
        const nodes = [...root.querySelectorAll(selector)].filter(node => !node.closest('.variation, .variations, .analysis-variation'));
        if (!nodes.length) continue;
        const moves = nodes.map(sanFromNode);
        // Keep entire sequences only. A missing move would change whose turn it is.
        if (moves.some(move => !move)) continue;
        if (!histories.some(history => history.join(' ') === moves.join(' '))) histories.push(moves);
      }
    }
    return histories.sort((a, b) => b.length - a.length);
  }

  function readPosition() {
    try {
      const board = findBoard();
      const placement = readPieces(board);
      const historyCandidates = readHistory();
      const { turn, turnSource } = readTurn(board);
      const warnings = ['Board squares alone do not establish castling rights or en passant. Use verified move history or a full FEN for exact analysis.'];
      if (!historyCandidates.length) warnings.push('No complete move list was readable.');
      if (!turn) warnings.push('The side to move could not be read.');
      const gameKey = typeof location === 'undefined' ? null : location.origin + location.pathname + (board.dataset.gameId ? `#game=${board.dataset.gameId}` : '');
      return { ok: true, placement, turn, turnSource, orientation: orientationOf(board), warnings, gameKey, moveHistory: historyCandidates[0] || [], historyCandidates };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  globalThis.ChessBoardReader = { readPosition, readPieces, readHistory, sanFromNode, pieceOn, PIECE_NAMES };
  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'READ_POSITION') sendResponse(readPosition());
    });
  }
})();

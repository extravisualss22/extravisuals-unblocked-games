import { Chess } from './vendor/chess.js';

export const START = new Chess().fen();
export const placement = game => game.fen().split(' ')[0];

export function cloneGame(game) {
  const history = game.history({ verbose: true });
  const clone = new Chess(history[0]?.before || game.fen());
  for (const move of history) clone.move(move);
  return clone;
}

export function resolveSnapshot(snapshot, previous) {
  if (!snapshot.ok || !snapshot.placement) throw new Error(snapshot.error || 'Open a Chess.com game with a visible board.');
  const candidates = snapshot.historyCandidates || [snapshot.moveHistory || []];
  for (const moves of candidates) {
    if (!moves.length) continue;
    const game = new Chess();
    try {
      for (const san of moves) game.move(san);
      if (placement(game) === snapshot.placement && (!snapshot.turn || snapshot.turn === game.turn())) {
        return { game, source: 'Verified move history' };
      }
    } catch { /* Partial or unsupported move list: try another source. */ }
  }
  if (previous && placement(previous) === snapshot.placement && (!snapshot.turn || previous.turn() === snapshot.turn)) {
    return { game: previous, source: 'Board in sync' };
  }
  if (!previous && snapshot.placement === START.split(' ')[0] && (!snapshot.turn || snapshot.turn === 'w')) {
    return { game: new Chess(), source: 'Starting position' };
  }
  if (previous) {
    // Catch up by one or two legal plies between polls, preserving full state.
    const candidates = [];
    const trial = cloneGame(previous);
    const visit = depth => {
      for (const move of trial.moves({ verbose: true })) {
        trial.move(move);
        if (placement(trial) === snapshot.placement && (!snapshot.turn || trial.turn() === snapshot.turn)) {
          candidates.push(cloneGame(trial));
        } else if (depth > 1) visit(depth - 1);
        trial.undo();
      }
    };
    visit(2);
    const unique = new Map(candidates.map(game => [game.fen(), game]));
    if (unique.size === 1) return { game: unique.values().next().value, source: 'Verified legal moves' };
  }
  throw new Error('Board found, but its full position could not be verified. Paste the game’s FEN or complete PGN below to sync it.');
}

export function importPosition(text) {
  const value = text.trim();
  if (!value) throw new Error('Paste a FEN position or PGN game first.');
  if (/^[prnbqkPRNBQK1-8/]+\s+[wb]\s/.test(value)) return new Chess(value);
  const game = new Chess();
  game.loadPgn(value);
  if (!game.history().length && !/\[FEN\s/.test(value)) throw new Error('No moves found. Paste a FEN position or complete PGN.');
  return game;
}

export function analysisPosition(game) {
  const history = game.history({ verbose: true });
  return {
    fen: history[0]?.before || game.fen(),
    moves: history.map(move => move.from + move.to + (move.promotion || '')),
  };
}

export function moveDetails(game, uci) {
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    const copy = new Chess(game.fen());
    return copy.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch { return null; }
}

export function variation(game, moves = []) {
  const copy = new Chess(game.fen());
  const result = [];
  for (const uci of moves.slice(0, 10)) {
    const move = moveDetails(copy, uci);
    if (!move) break;
    copy.move(move);
    result.push(move.san);
  }
  return result.join('  ');
}

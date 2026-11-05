import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../chess-assistant/vendor/chess.js';
import { START, placement, cloneGame, resolveSnapshot, importPosition, analysisPosition, moveDetails, variation } from '../chess-assistant/position.js';

function play(moves, fen) {
  const game = new Chess(fen);
  for (const move of moves) game.move(move);
  return game;
}
function snapshot(game, historyCandidates = []) {
  return { ok: true, placement: placement(game), turn: game.turn(), historyCandidates };
}

test('complete legal move history must match the visible board and side to move', () => {
  const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'];
  const game = play(moves);
  const resolved = resolveSnapshot(snapshot(game, [['e4', 'e5'], moves]));
  assert.equal(resolved.source, 'Verified move history');
  assert.equal(resolved.game.fen(), game.fen());
  assert.deepEqual(resolved.game.history(), moves);
  assert.throws(() => resolveSnapshot({ ...snapshot(game, [moves]), turn: 'b' }), /could not be verified/);
});

test('mid-game squares without full history or trusted previous state are rejected', () => {
  const game = play(['e4', 'c5', 'Nf3']);
  assert.throws(() => resolveSnapshot(snapshot(game)), /full position could not be verified/);
  assert.throws(() => resolveSnapshot(snapshot(game, [['not-a-move']])), /could not be verified/);
  assert.throws(() => resolveSnapshot({ ok: false, error: 'No board' }), /No board/);
});

test('fresh starting board resolves without history; caller can reset between games', () => {
  const newGame = new Chess();
  const resolved = resolveSnapshot(snapshot(newGame), null);
  assert.equal(resolved.game.fen(), START);
  assert.deepEqual(resolved.game.history(), []);
});

test('same board in an existing game preserves repetition and move counters', () => {
  const previous = play(['Nf3', 'Nf6', 'Ng1', 'Ng8']);
  const resolved = resolveSnapshot(snapshot(previous), previous);
  assert.equal(resolved.game.fen(), previous.fen());
  assert.deepEqual(resolved.game.history(), previous.history());
});

test('legal move inference preserves castling rights and leaves previous object untouched', () => {
  const previous = new Chess('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  const original = previous.fen();
  const expected = cloneGame(previous);
  expected.move('Rh2');
  const resolved = resolveSnapshot(snapshot(expected), previous);
  assert.equal(resolved.game.fen(), expected.fen());
  assert.equal(resolved.game.fen().split(' ')[2], '-');
  assert.equal(previous.fen(), original);
  assert.deepEqual(previous.history(), []);
});

test('legal move inference preserves an en passant target and capture', () => {
  const previous = new Chess('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
  const expected = cloneGame(previous);
  expected.move('d5');
  const resolved = resolveSnapshot(snapshot(expected), previous);
  assert.equal(resolved.game.fen().split(' ')[3], 'd6');
  const capture = resolved.game.move('exd6');
  assert.ok(capture.isEnPassant());
});

test('two unseen legal plies are reconstructed in order', () => {
  const previous = play(['e4']);
  const expected = play(['e4', 'e5', 'Nf3']);
  const resolved = resolveSnapshot(snapshot(expected), previous);
  assert.equal(resolved.game.fen(), expected.fen());
  assert.deepEqual(resolved.game.history(), expected.history());
});

test('imports support FEN, full PGN, custom-position PGN, and reject malformed input', () => {
  const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
  assert.equal(importPosition(fen).fen(), fen);
  assert.deepEqual(importPosition('1. e4 e5 2. Nf3 Nc6').history(), ['e4', 'e5', 'Nf3', 'Nc6']);
  const pgn = `[SetUp "1"]\n[FEN "${fen}"]\n\n1. Rh2`;
  assert.equal(importPosition(pgn).fen(), play(['Rh2'], fen).fen());
  for (const invalid of ['', 'not chess', '1. e4 e5 2. e4', '8/8/8/8/8/8/8/8 w - - 0 1', '1-0']) {
    assert.throws(() => importPosition(invalid), undefined, `Must reject ${JSON.stringify(invalid)}`);
  }
});

test('engine position payload includes complete reversible move history for repetition', () => {
  const moves = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];
  const game = play(moves);
  assert.equal(game.isThreefoldRepetition(), true);
  const copy = cloneGame(game);
  assert.equal(copy.isThreefoldRepetition(), true);
  const payload = analysisPosition(copy);
  assert.equal(payload.fen, START);
  assert.deepEqual(payload.moves, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
  const replay = new Chess(payload.fen);
  for (const uci of payload.moves) replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  assert.equal(replay.isThreefoldRepetition(), true);
});

test('engine payload retains custom starting FEN and promotion notation', () => {
  const fen = '7k/P7/8/8/8/8/8/7K w - - 0 1';
  const game = play(['a8=Q+'], fen);
  assert.deepEqual(analysisPosition(game), { fen, moves: ['a7a8q'] });
  assert.equal(moveDetails(new Chess(fen), 'a7a8q').san, 'a8=Q+');
  assert.equal(moveDetails(game, 'a7a8q'), null);
  assert.equal(variation(new Chess(), ['e2e4', 'e7e5', 'invalid']), 'e4  e5');
});

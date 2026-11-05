import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine, parseInfo } from '../engine.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';
class FakeWorker {
  static instances = [];
  constructor() { this.commands = []; FakeWorker.instances.push(this); }
  postMessage(command) { this.commands.push(command); }
  terminate() { this.terminated = true; }
  emit(data) { this.onmessage({ data }); }
}
globalThis.Worker = FakeWorker;

async function start(engine) {
  const promise = engine.start();
  const worker = FakeWorker.instances.at(-1);
  worker.emit('option name Hash type spin default 16 min 1 max 33554432');
  worker.emit('option name UCI_LimitStrength type check default false');
  worker.emit('option name Skill Level type spin default 20 min 0 max 20');
  worker.emit('uciok');
  worker.emit('readyok');
  await promise;
  return worker;
}

test('parses engine evaluation, bound, principal variation and statistics', () => {
  assert.deepEqual(parseInfo('info depth 22 seldepth 31 multipv 1 score cp -43 upperbound nodes 400 nps 5000 time 80 pv e7e5 g1f3'), {
    depth: 22, seldepth: 31, multipv: 1, nodes: 400, nps: 5000, timeMs: 80,
    score: { type: 'cp', value: -43, bound: 'upperbound' }, pv: ['e7e5', 'g1f3'],
  });
  assert.deepEqual(parseInfo('info depth 5 score mate 1 pv a7a8q'), {
    depth: 5, score: { type: 'mate', value: 1 }, pv: ['a7a8q'],
  });
  assert.equal(parseInfo('info string NNUE evaluation enabled'), null);
});

test('rapid position changes discard stale results and search only the newest pending position', async () => {
  const infos = [], best = [];
  const engine = new Engine({ onInfo: info => infos.push(info), onBestMove: move => best.push(move) });
  try {
    const worker = await start(engine);
    assert.ok(worker.commands.includes('setoption name Hash value 128'));
    assert.ok(worker.commands.includes('setoption name UCI_LimitStrength value false'));
    const first = engine.analyze({ fen: START, timeMs: 1000 });
    worker.emit('readyok');
    worker.emit('info depth 10 score cp 30 pv e2e4 e7e5');
    assert.equal(infos[0].token, first);
    engine.analyze({ fen: AFTER_E4 });
    const latest = engine.analyze({ fen: AFTER_D4 });
    worker.emit('info depth 11 score cp 40 pv e2e4');
    worker.emit('bestmove e2e4 ponder e7e5');
    assert.equal(infos.length, 1);
    assert.equal(best.length, 0);
    assert.equal(worker.commands.filter(command => command === 'stop').length, 1);
    assert.ok(!worker.commands.some(command => command.includes(AFTER_E4)));
    worker.emit('readyok');
    assert.ok(worker.commands.includes(`position fen ${AFTER_D4}`));
    worker.emit('info depth 17 score cp -12 pv d7d5 c2c4');
    worker.emit('bestmove d7d5 ponder c2c4');
    assert.equal(best.length, 1);
    assert.deepEqual(best[0], {
      token: latest, fen: AFTER_D4, move: 'd7d5', ponder: 'c2c4',
      depth: 17, score: { type: 'cp', value: -12 }, pv: ['d7d5', 'c2c4'],
    });
  } finally { engine.dispose(); }
});

test('stop clears a pending position and ignores canceled search output', async () => {
  const best = [];
  const engine = new Engine({ onBestMove: result => best.push(result) });
  try {
    const worker = await start(engine);
    engine.analyze({ fen: START });
    worker.emit('readyok');
    engine.analyze({ fen: AFTER_E4 });
    engine.stop();
    worker.emit('bestmove e2e4');
    assert.equal(best.length, 0);
    assert.equal(engine.state, 'ready');
    assert.ok(!worker.commands.some(command => command.includes(AFTER_E4)));
  } finally { engine.dispose(); }
});

test('terminal bestmove is null; invalid commands are rejected before reaching the worker', async () => {
  const best = [];
  const engine = new Engine({ onBestMove: result => best.push(result) });
  try {
    const worker = await start(engine);
    assert.throws(() => engine.analyze({ fen: `${START}\ngo infinite` }), /FEN/);
    assert.throws(() => engine.analyze({ fen: START, moves: ['e2e4\ngo infinite'] }), /history/);
    engine.analyze({ fen: START });
    worker.emit('readyok');
    worker.emit('bestmove 0000');
    assert.equal(best[0].move, null);
  } finally { engine.dispose(); }
});

test('worker startup error rejects initialization and permits a clean retry', async () => {
  const errors = [];
  const engine = new Engine({ onError: error => errors.push(error.message) });
  try {
    const firstStart = engine.start();
    const firstWorker = FakeWorker.instances.at(-1);
    firstWorker.onerror({ message: 'missing WASM' });
    await assert.rejects(firstStart, /missing WASM/);
    assert.ok(firstWorker.terminated);
    assert.equal(errors.length, 1);
    const nextWorker = await start(engine);
    assert.notEqual(firstWorker, nextWorker);
    assert.equal(engine.state, 'ready');
  } finally { engine.dispose(); }
});

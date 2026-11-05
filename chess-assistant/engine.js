// Stockfish's full neural-network build, running locally in a dedicated worker.
function engineURL() {
  // The downloadable website supplies a local Blob URL; the extension uses
  // its packaged worker. Neither path loads remote executable code.
  return globalThis.CHESS_ENGINE_URL || new URL('./vendor/stockfish-19-single.js', import.meta.url);
}
const FEN_PATTERN = /^[prnbqkPRNBQK1-8/]+ [wb] (?:-|[KQkq]+) (?:-|[a-h][36]) \d+ [1-9]\d*$/;
const MOVE_PATTERN = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function parseInfo(line) {
  if (!line.startsWith('info ') || /^info string\b/.test(line)) return null;
  const result = {};
  for (const key of ['depth', 'seldepth', 'nodes', 'nps', 'multipv']) {
    const match = line.match(new RegExp(`\\b${key} (\\d+)`));
    if (match) result[key] = Number(match[1]);
  }
  const time = line.match(/\btime (\d+)/);
  if (time) result.timeMs = Number(time[1]);
  const score = line.match(/\bscore (cp|mate) (-?\d+)(?: (lowerbound|upperbound))?/);
  if (score) {
    result.score = { type: score[1], value: Number(score[2]) };
    if (score[3]) result.score.bound = score[3];
  }
  const pv = line.match(/\bpv (.+)$/);
  if (pv) result.pv = pv[1].trim().split(/\s+/).filter(move => MOVE_PATTERN.test(move));
  return Object.keys(result).length ? result : null;
}

/**
 * Call analyze({fen, timeMs}) whenever the board changes. A newer request cancels
 * an older one; no information from a canceled search reaches the callbacks.
 * Scores are from the side-to-move perspective of the analyzed position.
 */
export class Engine {
  constructor({ onStatus = () => {}, onInfo = () => {}, onBestMove = () => {}, onError = () => {} } = {}) {
    this.onStatus = onStatus;
    this.onInfo = onInfo;
    this.onBestMove = onBestMove;
    this.onError = onError;
    this.worker = null;
    this.state = 'idle';
    this.sequence = 0;
    this.pending = null;
    this.active = null;
    this.barrier = false;
    this.options = new Set();
    this.startPromise = null;
    this.resolveStart = null;
    this.rejectStart = null;
    this.timer = null;
    this.generation = 0;
  }

  _status(state, message) {
    this.state = state;
    this.onStatus({ state, message });
  }

  _clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  _deadline(milliseconds, message) {
    this._clearTimer();
    this.timer = setTimeout(() => this._fail(new Error(message)), milliseconds);
  }

  _send(command) {
    this.worker.postMessage(command);
  }

  start() {
    if (this.state === 'disposed') return Promise.reject(new Error('The engine has been closed.'));
    if (this.startPromise) return this.startPromise;
    this.options.clear();
    this.startPromise = new Promise((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
    // Keep a reference: a synchronous worker failure resets startPromise.
    const promise = this.startPromise;
    const generation = ++this.generation;
    this._status('loading', 'Loading Stockfish 19…');
    const launch = url => {
      if (this.state !== 'loading' || generation !== this.generation) return;
      this.worker = new Worker(url);
      this.worker.onmessage = event => {
        for (const line of String(event.data).split(/\r?\n/)) this._line(line.trim());
      };
      this.worker.onerror = event => {
        event.preventDefault?.();
        this._fail(new Error(event.message || 'Stockfish could not load. Reload the extension and try again.'));
      };
      this.worker.onmessageerror = () => this._fail(new Error('The engine returned an unreadable response.'));
      this._deadline(60000, 'Stockfish took too long to load. Reload the extension and try again.');
      this._send('uci');
    };
    try {
      if (typeof globalThis.CHESS_PREPARE_ENGINE === 'function') {
        this._deadline(240000, 'The engine download took too long. Check your connection and try again.');
        Promise.resolve(globalThis.CHESS_PREPARE_ENGINE(message => this.onStatus({state:'loading',message})))
          .then(launch).catch(error => { if (generation === this.generation) this._fail(error); });
      } else launch(engineURL());
    } catch (error) {
      this._fail(error);
    }
    return promise;
  }

  analyze({ fen, moves = [], timeMs = 5000 }) {
    if (this.state === 'disposed') throw new Error('The engine has been closed.');
    if (typeof fen !== 'string' || !FEN_PATTERN.test(fen.trim())) throw new Error('A complete FEN position is required.');
    if (!Array.isArray(moves) || moves.some(move => !MOVE_PATTERN.test(move))) throw new Error('Invalid UCI move history.');
    if (!Number.isFinite(Number(timeMs))) throw new Error('Invalid analysis time.');
    const token = ++this.sequence;
    this.pending = { token, fen: fen.trim(), moves: [...moves], timeMs: Math.max(250, Math.min(60000, Math.round(Number(timeMs)))) };
    if (this.active) this._cancelActive();
    if (this.state === 'idle' || this.state === 'error' || this.state === 'loading') {
      // Errors are also delivered through onError; avoid an unhandled rejection
      // when analyze() is used without an explicit start() call.
      this.start().then(() => this._pump()).catch(() => {});
    } else {
      this._pump();
    }
    return token;
  }

  _cancelActive() {
    if (!this.active || this.active.canceled) return;
    this.active.canceled = true;
    this._status('stopping', 'Updating position…');
    this._deadline(10000, 'Stockfish did not stop its previous search. Try reloading the extension.');
    this._send('stop');
  }

  stop() {
    this.pending = null;
    if (this.active) this._cancelActive();
  }

  _pump() {
    if (!this.pending || this.active || this.barrier || this.state !== 'ready') return;
    // Synchronize before assigning a request to the engine. In particular, wait
    // for the canceled search's bestmove before entering this barrier.
    this.barrier = true;
    this._deadline(10000, 'Stockfish is not responding. Reload the extension and try again.');
    this._send('isready');
  }

  _beginLatest() {
    if (!this.pending) return;
    this.active = { ...this.pending, canceled: false, info: {} };
    this.pending = null;
    const request = this.active;
    this._status('thinking', 'Analyzing position…');
    const history = request.moves.length ? ` moves ${request.moves.join(' ')}` : '';
    this._send(`position fen ${request.fen}${history}`);
    this._deadline(request.timeMs + 15000, 'Stockfish did not finish its search. Try a shorter analysis time.');
    this._send(`go movetime ${request.timeMs}`);
  }

  _line(line) {
    if (!line || this.state === 'disposed' || this.state === 'error') return;
    if (this.state === 'loading') {
      const option = line.match(/^option name (.+?) type /);
      if (option) this.options.add(option[1]);
      if (line === 'uciok') {
        for (const [name, value] of [['Hash', 128], ['Threads', 1], ['MultiPV', 1], ['UCI_LimitStrength', 'false'], ['Skill Level', 20]]) {
          if (this.options.has(name)) this._send(`setoption name ${name} value ${value}`);
        }
        this._send('isready');
      } else if (line === 'readyok') {
        this._clearTimer();
        this._status('ready', 'Stockfish 19 ready');
        this.resolveStart?.();
        this.resolveStart = null;
        this.rejectStart = null;
        this._pump();
      }
      return;
    }
    if (line === 'readyok' && this.barrier) {
      this.barrier = false;
      this._clearTimer();
      this._beginLatest();
      return;
    }
    if (!this.active) return;
    const request = this.active;
    if (line.startsWith('bestmove ')) {
      this._clearTimer();
      this.active = null;
      this._status('ready', 'Analysis complete');
      if (!request.canceled) {
        const [, move, , ponder] = line.split(/\s+/);
        this.onBestMove({
          ...request.info,
          token: request.token,
          fen: request.fen,
          move: MOVE_PATTERN.test(move) ? move : null,
          ponder: ponder && MOVE_PATTERN.test(ponder) ? ponder : null,
        });
      }
      this._pump();
      return;
    }
    if (request.canceled) return;
    const info = parseInfo(line);
    if (!info || (info.multipv && info.multipv !== 1)) return;
    request.info = { ...request.info, ...info };
    this.onInfo({ ...request.info, token: request.token, fen: request.fen });
  }

  _fail(error) {
    this.generation++;
    this._clearTimer();
    this.worker?.terminate();
    this.worker = null;
    this.active = null;
    this.pending = null;
    this.barrier = false;
    this.rejectStart?.(error);
    this.resolveStart = null;
    this.rejectStart = null;
    this.startPromise = null;
    this._status('error', error.message);
    this.onError(error);
  }

  dispose() {
    this.generation++;
    this._clearTimer();
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
    this.active = null;
    this.barrier = false;
    this.rejectStart?.(new Error('The engine was closed.'));
    this.resolveStart = null;
    this.rejectStart = null;
    this.startPromise = null;
    this._status('disposed', 'Engine closed');
  }
}

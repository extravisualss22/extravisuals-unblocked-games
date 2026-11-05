import { cloneGame } from './position.js';

const SAMPLE_SIZE = 320;
const INTERVAL_MS = 240;
const STABLE_MS = 550;

/** Turn an 8x8 board image into edge features. Flat square highlights disappear. */
export function boardFeatures(image, orientation = 'white') {
  if (!image?.data || image.width !== image.height || image.width % 8) throw new Error('A square board image is required.');
  const width = image.width;
  const tile = width / 8;
  const margin = Math.max(2, Math.round(tile * 0.13));
  const luma = (x, y) => {
    const i = (y * width + x) * 4;
    return image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
  };
  const result = {};
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const file = orientation === 'white' ? column : 7 - column;
      const rank = orientation === 'white' ? 8 - row : row + 1;
      const square = String.fromCharCode(97 + file) + rank;
      const feature = [];
      for (let y = row * tile + margin; y < (row + 1) * tile - margin; y++) {
        for (let x = column * tile + margin; x < (column + 1) * tile - margin; x++) {
          const dx = luma(x + 1, y) - luma(x - 1, y);
          const dy = luma(x, y + 1) - luma(x, y - 1);
          feature.push(Math.min(1, Math.hypot(dx, dy) / 100));
        }
      }
      result[square] = Float32Array.from(feature);
    }
  }
  return result;
}

export function featureDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

export function changedSquares(before, after, threshold = 0.045) {
  return Object.keys(before).filter(square => featureDistance(before[square], after[square]) > threshold).sort();
}

/** Exact legal-square changes, including castling and en passant; no guessing. */
export function candidateMoves(game, squares) {
  if (!Array.isArray(squares) || squares.length < 2 || squares.length > 4) return [];
  const target = [...new Set(squares)].sort().join(',');
  const trial = cloneGame(game);
  const original = new Map(trial.board().flat().filter(Boolean).map(piece => [piece.square, piece.color + piece.type]));
  const result = [];
  for (const move of trial.moves({ verbose: true })) {
    trial.move(move);
    const next = new Map(trial.board().flat().filter(Boolean).map(piece => [piece.square, piece.color + piece.type]));
    const changed = [...new Set([...original.keys(), ...next.keys()])].filter(square => original.get(square) !== next.get(square)).sort().join(',');
    if (changed === target) result.push({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}), san: move.san });
    trial.undo();
  }
  return result;
}

/**
 * Screen sharing is a visual assistant, not an authoritative position source.
 * Every suggested move requires user confirmation; this class never plays it.
 */
export class BoardCapture {
  constructor({ video, canvas, onCandidate = () => {}, onState = () => {} }) {
    if (!video || !canvas) throw new Error('A video and preview canvas are required.');
    this.video = video;
    this.canvas = canvas;
    this.onCandidate = onCandidate;
    this.onState = onState;
    this.stream = null;
    this.crop = null;
    this.corner = null;
    this.game = null;
    this.orientation = 'white';
    this.baseline = null;
    this.previousFrame = null;
    this.pendingFrame = null;
    this.pendingFen = null;
    this.signature = '';
    this.stableSince = 0;
    this.tracking = false;
    this.state = 'idle';
    this.timer = null;
    this.generation = 0;
    this.dimensions = '';
    this.sampler = document.createElement('canvas');
    this.sampler.width = this.sampler.height = SAMPLE_SIZE;
    this.context = this.sampler.getContext('2d', { willReadFrequently: true });
    this.handleClick = event => this._calibrationClick(event);
    canvas.addEventListener('click', this.handleClick);
    this.handleHide = () => {
      if (document.hidden && this.tracking) this.pause('Watching paused while this analysis tab is hidden. Return here and confirm the current position before watching again.');
    };
    document.addEventListener('visibilitychange', this.handleHide);
    this.handleUnload = () => this.stop();
    window.addEventListener('pagehide', this.handleUnload);
  }

  _state(state, message) {
    this.state = state;
    this.onState({ state, message, calibrated: Boolean(this.crop), tracking: this.tracking });
  }

  async start() {
    this.stop();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this._state('error', 'Tab sharing is unavailable. Use an HTTPS website in a supported Chrome browser, or enter moves manually.');
      return false;
    }
    this._state('sharing', 'Choose the Chess.com tab in Chrome’s sharing prompt.');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser', frameRate: { ideal: 5, max: 10 } }, audio: false });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.muted = true;
      this.video.playsInline = true;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (this.stream === stream) this.stop('Screen sharing ended.'); }, { once: true });
      await this.video.play();
      if (generation !== this.generation) return false;
      this.dimensions = `${this.video.videoWidth}x${this.video.videoHeight}`;
      this.beginCalibration();
      this._tick();
      this.timer = setInterval(() => this._tick(), INTERVAL_MS);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stream?.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.video.srcObject = null;
      const message = error.name === 'NotAllowedError' ? 'Screen sharing was canceled or blocked. You can still paste FEN/PGN or enter moves manually.' : `Screen sharing could not start: ${error.message}`;
      this._state('error', message);
      return false;
    }
  }

  beginCalibration() {
    if (!this.stream) return false;
    this.tracking = false;
    this.crop = null;
    this.corner = null;
    this.baseline = null;
    this.previousFrame = null;
    this._state('calibrating', 'Click the board’s top-left outer corner in the shared preview, then its bottom-right outer corner.');
    return true;
  }

  _calibrationClick(event) {
    if (this.state !== 'calibrating' || !this.video.videoWidth) return;
    const rect = this.canvas.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(this.video.videoWidth, (event.clientX - rect.left) / rect.width * this.video.videoWidth)),
      y: Math.max(0, Math.min(this.video.videoHeight, (event.clientY - rect.top) / rect.height * this.video.videoHeight)),
    };
    if (!this.corner) {
      this.corner = point;
      this._state('calibrating', 'Now click the board’s bottom-right outer corner. Include all 64 squares.');
      return;
    }
    const width = point.x - this.corner.x;
    const height = point.y - this.corner.y;
    if (width < 120 || height < 120 || Math.abs(width / height - 1) > 0.08) {
      this.corner = null;
      this._state('calibrating', 'That selection was not a square board. Start again at its top-left outer corner.');
      return;
    }
    this.crop = { x: this.corner.x, y: this.corner.y, width, height };
    this.corner = null;
    this._state('ready', 'Board area selected. Make the analysis position and orientation match the shared board, then choose Start watching.');
  }

  _features() {
    if (!this.crop || !this.video.videoWidth) throw new Error('Select the board area first.');
    const { x, y, width, height } = this.crop;
    this.context.drawImage(this.video, x, y, width, height, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return boardFeatures(this.context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE), this.orientation);
  }

  seed(game, orientation = 'white') {
    if (!this.stream || !this.crop) throw new Error('Share a tab and select the board area first.');
    if (document.hidden) throw new Error('Keep this analysis page visible while watching.');
    this.orientation = orientation;
    this.game = cloneGame(game);
    this.baseline = this._features();
    this.previousFrame = this.baseline;
    this.pendingFrame = null;
    this.pendingFen = null;
    this.signature = '';
    this.stableSince = 0;
    this.tracking = true;
    this._state('tracking', 'Watching square changes. Check and confirm each suggested move before analysis updates.');
  }

  acknowledge(game) {
    if (!this.pendingFrame || !this.pendingFen || game.fen() !== this.pendingFen) {
      this.pause('The confirmed position differs from the suggested move. Match the shared board, then choose Start watching.');
      return false;
    }
    try {
      if (changedSquares(this.pendingFrame, this._features(), 0.025).length) {
        this.pause('The shared board changed again before confirmation. Enter any additional moves, then choose Start watching.');
        return false;
      }
      this.seed(game, this.orientation);
      return true;
    } catch (error) {
      this.pause(`Watching could not resume: ${error.message}`);
      return false;
    }
  }

  pause(message = 'Watching paused. Match the current position, then choose Start watching.') {
    this.tracking = false;
    this.signature = '';
    this.previousFrame = null;
    this.pendingFrame = null;
    this.pendingFen = null;
    this._state('paused', message);
  }

  reject() {
    this.pause('Move suggestion dismissed. Enter the correct move or import the current position, then choose Start watching.');
  }

  _tick() {
    if (!this.stream || !this.video.videoWidth || document.hidden) return;
    try {
      const dimensions = `${this.video.videoWidth}x${this.video.videoHeight}`;
      if (this.dimensions !== dimensions) {
        this.dimensions = dimensions;
        this.beginCalibration();
        this._state('calibrating', 'The shared tab size changed. Select the board corners again.');
      }
      const scale = Math.min(1, 960 / this.video.videoWidth);
      const width = Math.round(this.video.videoWidth * scale);
      const height = Math.round(this.video.videoHeight * scale);
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      const context = this.canvas.getContext('2d');
      context.drawImage(this.video, 0, 0, width, height);
      context.strokeStyle = '#eeb955';
      context.lineWidth = 3;
      if (this.crop) context.strokeRect(this.crop.x * scale, this.crop.y * scale, this.crop.width * scale, this.crop.height * scale);
      if (this.corner) {
        context.beginPath(); context.arc(this.corner.x * scale, this.corner.y * scale, 6, 0, Math.PI * 2); context.stroke();
      }
      if (!this.tracking) return;
      const current = this._features();
      const changed = changedSquares(this.baseline, current);
      if (!changed.length) { this.previousFrame = current; this.signature = ''; this.stableSince = 0; return; }
      const signature = changed.join(',');
      const steady = this.previousFrame && changedSquares(this.previousFrame, current, 0.025).length === 0;
      this.previousFrame = current;
      if (!steady || signature !== this.signature) {
        this.signature = signature;
        this.stableSince = performance.now();
        return;
      }
      if (performance.now() - this.stableSince < STABLE_MS) return;
      const candidates = candidateMoves(this.game, changed);
      this.tracking = false;
      if (candidates.length === 1) {
        this.pendingFrame = current;
        const after = cloneGame(this.game);
        after.move(candidates[0]);
        this.pendingFen = after.fen();
        this._state('paused', `Possible move: ${candidates[0].san}. Check the shared board and confirm it below.`);
        this.onCandidate({ move: candidates[0], changedSquares: changed, fen: this.game.fen() });
      } else {
        this._state('paused', candidates.length > 1 ? 'The change matches several moves, including a possible promotion. Enter the move manually, then resume watching.' : 'The changed squares did not match one legal move. Check the board position and crop, enter missed moves manually, then resume watching.');
      }
    } catch (error) {
      this.tracking = false;
      this._state('error', `Could not read the shared board: ${error.message}. Enter moves manually or calibrate again.`);
    }
  }

  stop(message = 'Screen sharing is off.') {
    this.generation++;
    clearInterval(this.timer);
    this.timer = null;
    const stream = this.stream;
    this.stream = null;
    stream?.getTracks().forEach(track => track.stop());
    this.video.srcObject = null;
    this.tracking = false;
    this.crop = null;
    this.corner = null;
    this.baseline = null;
    this.game = null;
    this.previousFrame = null;
    this.pendingFrame = null;
    this.pendingFen = null;
    this._state('idle', message);
  }

  dispose() {
    this.stop();
    this.canvas.removeEventListener('click', this.handleClick);
    document.removeEventListener('visibilitychange', this.handleHide);
    window.removeEventListener('pagehide', this.handleUnload);
  }
}

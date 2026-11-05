import { Chess } from './vendor/chess.js';
import { Engine } from './engine.js';
import { importPosition, analysisPosition, moveDetails, variation } from './position.js';
import { BoardCapture } from './capture.js';

const $ = id => document.getElementById(id);
const glyphs = {k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const names = {k:'King',q:'Queen',r:'Rook',b:'Bishop',n:'Knight',p:'Pawn'};
let game = new Chess();
let orientation = 'white';
let selected = null;
let recommended = null;
let lastMove = null;
let token = null;
let pendingPromotion = null;
let pendingCapture = null;
let captureState = 'idle';
let source = 'Starting position';
let analyzing = false;

const engine = new Engine({
  onStatus({state,message}) { $('engine-status').textContent = message; analyzing = state === 'thinking' || state === 'loading'; },
  onInfo(info) {
    if (info.token !== token) return;
    if (info.depth) $('depth').textContent = `Depth ${info.depth}`;
    if (info.score) {
      const value = info.score.value * (game.turn() === 'w' ? 1 : -1);
      $('evaluation').textContent = info.score.type === 'mate' ? `${value < 0 ? '−' : ''}M${Math.abs(value)}` : `${value > 0 ? '+' : ''}${(value / 100).toFixed(2)}`;
      $('evaluation').title = 'Evaluation from White’s perspective';
    }
    if (info.pv?.length) showMove(info.pv[0], info.pv);
  },
  onBestMove(info) {
    if (info.token !== token) return;
    showMove(info.move, info.pv);
    $('engine-status').textContent = 'Analysis complete';
    analyzing = false;
  },
  onError(error) {
    token = null;
    analyzing = false;
    clearResult();
    notice(`Stockfish could not finish: ${error.message}. Press Analyze to retry.`);
    $('engine-status').textContent = 'Engine needs a retry';
  },
});

const capture = new BoardCapture({
  video:$('share-video'), canvas:$('share-canvas'),
  onState({state,message,calibrated}) {
    captureState = state;
    $('share-status').textContent = message;
    $('share-stop').disabled = state === 'idle';
    $('share-start').disabled = !['idle','error'].includes(state);
    $('share-seed').disabled = !calibrated;
    if (['idle','error','paused','calibrating'].includes(state)) clearCandidate();
  },
  onCandidate(candidate) {
    pendingCapture = { ...candidate, fen:game.fen() };
    cancelAnalysis();
    clearResult();
    $('share-candidate').textContent = `Possible move: ${candidate.move.san}. Check the shared board, then confirm.`;
    $('share-apply').disabled = false;
    $('move-description').textContent = 'Confirm the detected move below';
    $('engine-status').textContent = 'Waiting for your confirmation';
  },
});

function notice(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function clearCandidate() {
  pendingCapture = null;
  $('share-candidate').textContent = '';
  $('share-apply').disabled = true;
}

function invalidateCapture() {
  clearCandidate();
  if (!['idle','error'].includes(captureState)) capture.reject();
}

function cancelAnalysis() {
  token = null;
  engine.stop();
  analyzing = false;
}

function clearResult() {
  recommended = null;
  $('arrow').setAttribute('hidden','');
  $('best-move').textContent = '—';
  $('move-description').textContent = 'Ready to analyze your position';
  $('evaluation').textContent = '—';
  $('depth').textContent = 'Depth —';
  $('variation').textContent = 'The suggested continuation will appear here.';
}

function coordinates(square) {
  const file = square.charCodeAt(0)-97, rank = +square[1]-1;
  return orientation === 'white' ? [file*100+50,(7-rank)*100+50] : [(7-file)*100+50,rank*100+50];
}

function drawArrow() {
  $('arrow').toggleAttribute('hidden',!recommended);
  if (!recommended) return;
  const [x1,y1]=coordinates(recommended.from),[x2,y2]=coordinates(recommended.to);
  const trim=17/Math.hypot(x2-x1,y2-y1);
  for(const [key,value] of Object.entries({x1,y1,x2:x2-(x2-x1)*trim,y2:y2-(y2-y1)*trim})) $('best-arrow').setAttribute(key,value);
}

function render() {
  const legal = selected ? game.moves({square:selected,verbose:true}).map(move=>move.to) : [];
  $('board').replaceChildren();
  for (let row=0;row<8;row++) for(let col=0;col<8;col++) {
    const file = orientation==='white'?col:7-col;
    const rank = orientation==='white'?8-row:row+1;
    const square=String.fromCharCode(97+file)+rank;
    const piece=game.get(square);
    const cell=document.createElement('button');
    cell.type='button';
    cell.className=`square ${(file+rank)%2===0?'dark':'light'}${selected===square?' selected':''}${legal.includes(square)?' legal':''}${lastMove&&(lastMove.from===square||lastMove.to===square)?' last-move':''}`;
    cell.dataset.square=square;
    cell.setAttribute('aria-label',`${square}${piece?` ${piece.color==='w'?'White':'Black'} ${names[piece.type]}`:', empty'}${legal.includes(square)?', legal destination':''}`);
    cell.setAttribute('aria-pressed',String(selected===square));
    if(piece){const span=document.createElement('span');span.className=`piece ${piece.color==='w'?'white':'black'}`;span.textContent=glyphs[piece.type];span.setAttribute('aria-hidden','true');cell.append(span);}
    if(col===0){const label=document.createElement('span');label.className='rank';label.textContent=rank;label.setAttribute('aria-hidden','true');cell.append(label);}
    if(row===7){const label=document.createElement('span');label.className='file';label.textContent=square[0];label.setAttribute('aria-hidden','true');cell.append(label);}
    cell.addEventListener('click',()=>clickSquare(square));
    cell.addEventListener('keydown',event=>{
      const offsets={ArrowRight:1,ArrowLeft:-1,ArrowDown:8,ArrowUp:-8};
      if(!(event.key in offsets))return;
      event.preventDefault();
      const next=row*8+col+offsets[event.key];
      if(next>=0&&next<64)$('board').children[next].focus();
    });
    $('board').append(cell);
  }
  $('turn').textContent=game.isCheckmate()?'Checkmate':game.isStalemate()?'Stalemate':game.isDraw()?'Draw':`${game.turn()==='w'?'White':'Black'} to move${game.isCheck()?' · check':''}`;
  $('source').textContent=source;
  $('undo').disabled=game.history().length===0;
  const moves=game.history({verbose:true});
  $('history').textContent=moves.length?moves.map((move,index)=>`${move.color==='w'?`${move.before.split(' ')[5]}. `:index===0?`${move.before.split(' ')[5]}… `:''}${move.san}`).join('  '):'No moves entered yet';
  drawArrow();
}

function clickSquare(square) {
  if(pendingPromotion)return;
  if(selected===square){selected=null;render();return;}
  if(selected){
    const moves=game.moves({square:selected,verbose:true}).filter(move=>move.to===square);
    if(moves.length){
      if(moves.some(move=>move.promotion)){
        pendingPromotion={from:selected,to:square};
        $('promotion').showModal();
      } else commitMove(moves[0]);
      return;
    }
  }
  const piece=game.get(square);
  selected=piece?.color===game.turn()?square:null;
  render();
  $('board').querySelector(`[data-square="${square}"]`)?.focus();
}

function commitMove(move, fromCapture = false) {
  const result=game.move(move);
  selected=null;
  lastMove=result;
  source=fromCapture?'Confirmed from shared board':'Moves entered on this board';
  if(!fromCapture)invalidateCapture();
  notice();
  render();
  analyze();
}

function showMove(uci,pv=[]) {
  recommended=moveDetails(game,uci);
  if(!recommended){clearResult();$('move-description').textContent='No legal move available';return;}
  $('best-move').textContent=recommended.san;
  $('move-description').textContent=`${names[recommended.piece]} ${recommended.from} → ${recommended.to}${recommended.promotion?` · promote to ${names[recommended.promotion].toLowerCase()}`:''}`;
  $('variation').textContent=variation(game,pv?.length?pv:[uci]);
  drawArrow();
}

function analyze() {
  if(pendingCapture){notice('Confirm the detected move, or stop sharing to analyze the position currently shown.');return;}
  cancelAnalysis();
  clearResult();
  notice();
  if(game.isGameOver()){
    $('move-description').textContent=game.isCheckmate()?'Checkmate':game.isStalemate()?'Stalemate':'Draw';
    $('variation').textContent='This position is finished.';
    $('engine-status').textContent='Game over';
    return;
  }
  token=engine.analyze({...analysisPosition(game),timeMs:Number($('time').value)});
}

function replaceGame(next,label) {
  cancelAnalysis();
  invalidateCapture();
  game=next;
  selected=null;
  lastMove=game.history({verbose:true}).at(-1)||null;
  source=label;
  notice();
  render();
  analyze();
}

$('analyze').addEventListener('click',analyze);
$('stop').addEventListener('click',()=>{cancelAnalysis();$('engine-status').textContent='Analysis stopped';});
$('flip').addEventListener('click',()=>{orientation=orientation==='white'?'black':'white';render();});
$('undo').addEventListener('click',()=>{if(!game.history().length)return;game.undo();replaceGame(game,'Move taken back');});
$('reset').addEventListener('click',()=>replaceGame(new Chess(),'Starting position'));
$('time').addEventListener('change',()=>{if(token!==null||analyzing)analyze();});
$('import').addEventListener('click',()=>{
  try{const next=importPosition($('position-input').value);$('import-error').textContent='';replaceGame(next,'Imported FEN / PGN');}
  catch(error){$('import-error').textContent=error.message;}
});
$('fen-copy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(game.fen());notice('FEN copied.');}
  catch{$('position-input').value=game.fen();$('position-input').closest('details')?.setAttribute('open','');$('position-input').focus();$('position-input').select();notice('Select and copy the FEN in the import box.');}
});
document.querySelectorAll('[data-promotion]').forEach(button=>button.addEventListener('click',()=>{
  const move={...pendingPromotion,promotion:button.dataset.promotion};
  pendingPromotion=null;$('promotion').close();commitMove(move);
}));
$('promotion-cancel').addEventListener('click',()=>{$('promotion').close();pendingPromotion=null;});
$('promotion').addEventListener('cancel',()=>{pendingPromotion=null;});

$('share-start').addEventListener('click',async()=>{try{await capture.start();}catch(error){$('share-status').textContent=error.message;}});
$('share-stop').addEventListener('click',()=>{capture.stop();clearCandidate();});
$('share-seed').addEventListener('click',()=>{
  try{clearCandidate();capture.seed(game,$('share-orientation').value);analyze();}
  catch(error){$('share-status').textContent=error.message;}
});
$('share-orientation').addEventListener('change',()=>invalidateCapture());
$('share-apply').addEventListener('click',()=>{
  if(!pendingCapture||pendingCapture.fen!==game.fen()){invalidateCapture();return;}
  const move=pendingCapture.move;
  clearCandidate();
  try{commitMove(move,true);capture.acknowledge(game);}
  catch(error){$('share-status').textContent=error.message;capture.reject();}
});

window.addEventListener('pagehide',()=>{capture.stop();engine.dispose();});
render();
clearResult();
$('share-stop').disabled=true;
$('share-seed').disabled=true;
$('share-apply').disabled=true;

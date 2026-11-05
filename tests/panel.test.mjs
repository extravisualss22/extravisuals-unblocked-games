import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { Chess } from '../chess-assistant/vendor/chess.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

test('panel follows a verified game, rejects stale analysis, and analyzes imported mate with real Stockfish', {timeout:90000}, async()=>{
  const server=createServer(async(req,res)=>{
    try {
      const path=resolve('chess-assistant','.'+new URL(req.url,'http://local').pathname);
      if(!path.startsWith(resolve('chess-assistant')+'/')){res.writeHead(403).end();return;}
      const mime={'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css'}[extname(path)]||'text/plain';
      const data=await readFile(path);
      res.writeHead(200,{'Content-Type':mime,'Content-Security-Policy':"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'"});
      res.end(data);
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:390,height:1000}});
    const errors=[];page.on('pageerror',err=>errors.push(err.message));
    await page.addInitScript(({placement})=>{
      window.snapshot={ok:true,placement,historyCandidates:[],orientation:'white',turn:'w',gameKey:'game-1'};
      window.chrome={
        tabs:{query:async()=>[{id:1}],sendMessage:async()=>window.snapshot},
        storage:{local:{get:async()=>({thinkTime:'1000'}),set:async()=>{}}}
      };
    },{placement:new Chess().fen().split(' ')[0]});
    await page.goto(`http://127.0.0.1:${server.address().port}/panel.html`);
    await page.waitForFunction(()=>document.getElementById('engine-status').textContent==='Analysis complete',null,{timeout:60000});
    assert.notEqual(await page.locator('#best-move').textContent(),'—');
    assert.equal(await page.locator('#connection').textContent(),'Following Chess.com');
    await page.locator('#flip').click();
    await page.waitForTimeout(1100);
    assert.equal(await page.locator('.square').first().getAttribute('data-square'),'h1');
    const position=new Chess();position.move('e4');
    await page.evaluate(snapshot=>window.snapshot=snapshot,{ok:true,placement:position.fen().split(' ')[0],turn:'b',historyCandidates:[['e4']],orientation:'white',gameKey:'game-1'});
    await page.waitForFunction(()=>document.getElementById('turn').textContent==='Black to move');
    await page.waitForFunction(()=>document.getElementById('engine-status').textContent==='Analysis complete');
    assert.notEqual(await page.locator('#best-move').textContent(),'—');
    await page.evaluate(()=>window.snapshot={ok:false,error:'No readable board'});
    await page.waitForFunction(()=>document.getElementById('connection').textContent==='Waiting for your board');
    await page.locator('#analyze').click();
    assert.equal(await page.locator('#best-move').textContent(),'—','Cannot analyze a stale live board');
    await page.locator('#import-section summary').click();
    await page.locator('#position-input').fill('garbage');await page.locator('#import').click();
    assert.ok((await page.locator('#import-error').textContent()).length>0);
    await page.locator('#position-input').fill('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');await page.locator('#import').click();
    await page.waitForFunction(()=>document.getElementById('engine-status').textContent==='Analysis complete');
    assert.equal(await page.locator('#live').isChecked(),false);
    assert.match(await page.locator('#best-move').textContent(),/#$/);
    assert.equal(await page.locator('#evaluation').textContent(),'M1');
    assert.equal(await page.locator('#arrow').isVisible(),true);
    await page.screenshot({path:'/tmp/chess-companion-panel.png',fullPage:true});
    assert.deepEqual(errors,[]);
    await page.locator('#position-input').fill('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');await page.locator('#import').click();
    assert.equal(await page.locator('#move-description').textContent(),'Checkmate');
    assert.equal(await page.locator('#arrow').isVisible(),false);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});

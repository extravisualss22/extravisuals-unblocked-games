import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { Chess } from '../chess-assistant/vendor/chess.js';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
let server;
try {
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  page.setDefaultTimeout(20000);
  const errors=[],remote=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))remote.push(request.url());});
  await page.addInitScript(()=>{
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{
      if(!window.testStream)throw new DOMException('Canceled','NotAllowedError');
      return window.testStream;
    }});
  });
  if(process.env.TEST_OVER_HTTP==='1'){
    server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});createReadStream(resolve(process.env.STANDALONE_FILE || 'dist/travis.suda.html')).pipe(response);});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load',timeout:60000});
    remote.length=0;
  }else await page.goto(pathToFileURL(resolve(process.env.STANDALONE_FILE || 'dist/travis.suda.html')).href,{waitUntil:'load',timeout:60000});
  assert.equal(await page.locator('#board .square').count(),64);
  await page.locator('#time').selectOption('1000');
  await page.locator('#position-input').fill('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
  await page.locator('#import').click();
  await page.waitForFunction(()=>document.getElementById('engine-status').textContent==='Analysis complete',null,{timeout:60000});
  assert.match(await page.locator('#best-move').textContent(),/#$/);
  assert.equal(await page.locator('#evaluation').textContent(),'M1');
  assert.equal(await page.locator('#arrow').isVisible(),true);
  await page.locator('#position-input').fill('invalid');await page.locator('#import').click();
  assert.ok((await page.locator('#import-error').textContent()).length);
  await page.locator('#reset').click();
  await page.locator('[data-square=e2]').click();await page.locator('[data-square=e4]').click();
  assert.equal(await page.locator('#turn').textContent(),'Black to move');
  assert.match(await page.locator('#history').textContent(),/e4/);
  await page.locator('[data-square=e7]').click();await page.locator('[data-square=e5]').click();
  assert.equal(await page.locator('#turn').textContent(),'White to move');
  await page.locator('#undo').click();
  assert.equal(await page.locator('#turn').textContent(),'Black to move');
  await page.locator('#flip').click();
  assert.equal(await page.locator('.square').first().getAttribute('data-square'),'h1');
  await page.locator('#position-input').fill('7k/P7/6K1/8/8/8/8/8 w - - 0 1');await page.locator('#import').click();
  await page.locator('[data-square=a7]').click();await page.locator('[data-square=a8]').click();
  assert.equal(await page.locator('#promotion').isVisible(),true);
  await page.locator('[data-promotion=n]').click();
  assert.match(await page.locator('[data-square=a8]').getAttribute('aria-label'),/Knight/);
  await page.locator('#sharing-section summary').click();
  await page.locator('#share-start').click();
  assert.match(await page.locator('#share-status').textContent(),/canceled or blocked/);
  await page.locator('#reset').click();
  const initial=new Chess();
  await page.evaluate(board=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=640;
    const ctx=canvas.getContext('2d');
    window.paintTestBoard=board=>{
      for(let row=0;row<8;row++)for(let col=0;col<8;col++){
        ctx.fillStyle=(row+col)%2?'#72866a':'#e9e1c8';ctx.fillRect(col*80,row*80,80,80);
        const piece=board[row][col];if(!piece)continue;
        ctx.fillStyle=piece.color==='w'?'#fafafa':'#111111';ctx.strokeStyle=piece.color==='w'?'#111111':'#fafafa';ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(col*80+40,row*80+40,22,0,Math.PI*2);ctx.fill();ctx.stroke();
      }
    };
    window.paintTestBoard(board);window.testStream=canvas.captureStream(10);window.testCanvas=canvas;
  },initial.board());
  await page.locator('#share-start').click();
  await page.waitForFunction(()=>document.getElementById('share-canvas').width===640);
  const preview=await page.locator('#share-canvas').boundingBox();
  await page.locator('#share-canvas').click({position:{x:1,y:1}});
  await page.locator('#share-canvas').click({position:{x:preview.width-1,y:preview.height-1}});
  await page.locator('#share-seed').click();
  assert.match(await page.locator('#share-status').textContent(),/Watching square changes/);
  initial.move('e4');
  await page.evaluate(board=>window.paintTestBoard(board),initial.board());
  await page.waitForFunction(()=>!document.getElementById('share-apply').disabled);
  assert.match(await page.locator('#share-candidate').textContent(),/e4/);
  assert.equal(await page.locator('#turn').textContent(),'White to move','A detected move must not silently commit');
  await page.locator('#share-apply').click();
  assert.equal(await page.locator('#turn').textContent(),'Black to move');
  await page.locator('#share-stop').click();
  assert.equal(await page.evaluate(()=>window.testStream.getTracks()[0].readyState),'ended');
  await page.waitForFunction(()=>document.getElementById('engine-status').textContent==='Analysis complete');
  await page.locator('#sharing-section summary').click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/chess-website-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Mobile page should not overflow');
  await page.screenshot({path:'/tmp/chess-website-mobile.png',fullPage:true});
  assert.deepEqual(remote,[],'Standalone engine must make no HTTP requests');
  assert.deepEqual(errors,[],'No browser script errors');
  console.log(`PASS (${process.env.TEST_OVER_HTTP==='1'?'self-contained page over local HTTP':'direct file opening'}): Stockfish mate, manual moves, undo, promotion, denied sharing, calibrated capture with confirmation, stream cleanup, mobile layout, no network requests after page load.`);
} finally {await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}

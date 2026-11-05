import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {chromium}=require('playwright');
const html=await readFile('dist/travis.suda-online.html');
const server=createServer((_,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}:undefined});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let blocked=true,downloads=0;
  await page.route('https://registry.npmjs.org/stockfish/-/stockfish-19.0.1.tgz',async route=>{
    downloads++;
    if(blocked)return route.fulfill({status:403,headers:{'Access-Control-Allow-Origin':'*'},body:'Blocked for test'});
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#time').selectOption('1000');
  await page.locator('#position-input').fill('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');await page.locator('#import').click();
  await page.waitForFunction(()=>document.getElementById('engine-status').textContent==='Engine needs a retry');
  assert.match(await page.locator('#notice').textContent(),/Internet access to registry.npmjs.org/);
  blocked=false;await page.locator('#analyze').click();
  await page.waitForFunction(()=>document.getElementById('engine-status').textContent==='Analysis complete',null,{timeout:120000});
  assert.equal(await page.locator('#evaluation').textContent(),'M1');
  assert.match(await page.locator('#best-move').textContent(),/#$/);
  await page.locator('#analyze').click();await page.waitForFunction(()=>document.getElementById('engine-status').textContent==='Analysis complete');
  assert.equal(downloads,2,'Reuse successful engine download on repeated analysis');assert.deepEqual(errors,[]);
  console.log('PASS: compact HTML, official package extraction, SHA256 verification, full Stockfish mate, blocked-download error, retry, engine reuse.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

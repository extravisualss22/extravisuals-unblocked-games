import './build-web.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
let html=await readFile('dist/travis.suda.html','utf8');
for(const [id,file] of [['embedded-stockfish-wasm','stockfish-19-lite-single.wasm'],['embedded-stockfish-js','stockfish-19-lite-single.js']]){
 const start=html.indexOf('>',html.indexOf('<script id="'+id+'"'))+1;
 const end=html.indexOf('</script>',start);
 if(start<1||end<0)throw new Error('Embedded engine marker missing');
 html=html.slice(0,start)+(await readFile('node_modules/stockfish/bin/'+file)).toString('base64')+html.slice(end);
}
html=html.replace('<script>','<script>globalThis.CHESS_ENGINE_HASH_MB=32;globalThis.CHESS_ENGINE_STARTUP_MS=180000;')
 .replaceAll('full Stockfish 19','Stockfish 19 Lite').replaceAll('Full neural network.','Smaller network. Lower memory.')
 .replaceAll('full, unchanged Stockfish.js','lite, unchanged Stockfish.js')
 .replace('Stockfish analysis</title>','Chromebook edition</title>')
 .replace('On your device','Chromebook edition')
 .replace('More thinking time can reveal a stronger continuation.','Stockfish 19 Lite · 32 MB hash. A smaller, weaker network than the full edition.');
await writeFile('downloads/travis.suda-chromebook.html',html);
const r=spawnSync('python3',['-c',`from zipfile import ZipFile,ZIP_DEFLATED
with ZipFile('downloads/travis.suda-chromebook.zip','w',ZIP_DEFLATED) as z:
 z.write('downloads/travis.suda-chromebook.html','travis.suda-chromebook.html')
 z.writestr('START-HERE.txt','Close the older travis.suda tabs. Extract this ZIP and open travis.suda-chromebook.html in Chrome. This offline edition includes Stockfish 19 Lite, uses 32 MB hash memory, and allows up to 3 minutes to initialize. Its smaller neural network is weaker than the full edition. No engine download or extension is required. Enter your position and click Find best move.\\n')
`],{encoding:'utf8'});
if(r.status!==0)throw new Error(r.stderr);
console.log('Built Chromebook offline edition with Stockfish 19 Lite.');

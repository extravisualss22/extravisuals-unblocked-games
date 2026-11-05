import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const wasm=await readFile('chess-assistant/vendor/stockfish-19-single.wasm');
const worker=await readFile('chess-assistant/vendor/stockfish-19-single.js','utf8');
const expected=createHash('sha256').update(wasm).digest('hex');
const loader=`
let prepared;
globalThis.CHESS_PREPARE_ENGINE = report => {
  if(prepared)return prepared;
  prepared=(async()=>{
    report('Downloading full Stockfish 19…');
    const response=await fetch('https://registry.npmjs.org/stockfish/-/stockfish-19.0.1.tgz',{credentials:'omit'});
    if(!response.ok)throw new Error('Stockfish download failed (HTTP '+response.status+').');
    let received=0,last=0;
    const progress=new TransformStream({transform(chunk,controller){received+=chunk.length;if(received-last>1048576){last=received;report('Downloading Stockfish · '+Math.round(received/1048576)+' MB');}controller.enqueue(chunk);}});
    const reader=response.body.pipeThrough(progress).pipeThrough(new DecompressionStream('gzip')).getReader();
    let pending=new Uint8Array(0),offset=0;
    async function read(size,keep=true){
      const result=keep?new Uint8Array(size):null;let taken=0;
      while(taken<size){
        if(offset===pending.length){const next=await reader.read();if(next.done)throw new Error('The engine download was incomplete.');pending=next.value;offset=0;}
        const length=Math.min(size-taken,pending.length-offset);
        if(keep)result.set(pending.subarray(offset,offset+length),taken);
        taken+=length;offset+=length;
      }
      return result;
    }
    let data;
    const decoder=new TextDecoder();
    try{
      for(;;){
        const header=await read(512);
        const name=decoder.decode(header.subarray(0,100)).replace(/\\0.*$/s,'');
        if(!name)throw new Error('The Stockfish package did not contain its engine.');
        const size=parseInt(decoder.decode(header.subarray(124,136)).replace(/\\0.*$/s,'').trim(),8)||0;
        if(!Number.isSafeInteger(size)||size<0||size>250000000)throw new Error('Invalid engine archive.');
        if(name==='package/bin/stockfish-19-single.wasm'){data=await read(size);break;}
        await read(Math.ceil(size/512)*512,false);
      }
    }finally{await reader.cancel().catch(()=>{});}
    report('Checking engine download…');
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
    if(digest!==${JSON.stringify(expected)})throw new Error('Engine integrity check failed. Please retry the download.');
    const wasmURL=URL.createObjectURL(new Blob([data],{type:'application/wasm'}));
    const workerURL=URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'}));
    window.addEventListener('pagehide',()=>{URL.revokeObjectURL(wasmURL);URL.revokeObjectURL(workerURL);},{once:true});
    return workerURL+'#'+encodeURIComponent(wasmURL);
  })().catch(error=>{prepared=null;throw new Error('Could not load Stockfish. Internet access to registry.npmjs.org is required. '+error.message);});
  return prepared;
};
`;
const bundle=await build({stdin:{contents:loader+'\nimport "./chess-assistant/web.js";',resolveDir:process.cwd(),sourcefile:'online-entry.js'},bundle:true,write:false,format:'iife',platform:'browser',target:'chrome114',define:{'import.meta.url':JSON.stringify('file:///online-chess/')},legalComments:'inline'});
let html=await readFile('chess-assistant/web.html','utf8');
const css=await readFile('chess-assistant/web.css','utf8');
html=html.replace(/<link[^>]*href="web.css"[^>]*>/,()=>'<style>'+css+'</style>')
 .replace(/<script[^>]*src="web.js"[^>]*><\/script>/,()=>'<script>'+bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script>')
 .replace('Every calculation stays here.','Engine downloads on first use.')
 .replace('Stockfish starts with your first analysis','Internet required · full engine downloads on first analysis')
 .replace('href="README.md"','href="#online-help"')
 .replace('href="vendor/stockfish-LICENSE.txt"','href="https://github.com/nmrugg/stockfish.js/blob/v19.0.1/Copying.txt"')
 .replace('</body>','<p id="online-help" style="max-width:1100px;margin:20px auto;padding:16px;font:13px/1.6 system-ui">This small page downloads the full Stockfish 19 engine from the official npm package on first analysis. The engine download is large and may take a few minutes. Keep this tab open. Chess positions and screen sharing stay on your device. No extension or Developer mode is required. Network access to registry.npmjs.org must be allowed. <a href="https://github.com/nmrugg/stockfish.js/tree/v19.0.1">Stockfish source (GPLv3)</a> · <a href="https://github.com/jhlywa/chess.js/tree/v1.4.0">chess.js source (BSD-2-Clause)</a></p></body>');
const policy="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; worker-src blob:; connect-src blob: https://registry.npmjs.org; media-src blob:; img-src data: blob:; base-uri 'none'; object-src 'none'";
html=html.replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="'+policy+'">');
await mkdir('dist',{recursive:true});await writeFile('dist/travis.suda-online.html',html);
console.log('Built dist/travis.suda-online.html ('+Math.round(Buffer.byteLength(html)/1024)+' KB); full Stockfish 19 unchanged, SHA256 checked.');
const zip=spawnSync('python3',['-c',`from zipfile import ZipFile,ZIP_DEFLATED
with ZipFile('dist/travis.suda-small.zip','w',ZIP_DEFLATED) as z:
 z.write('dist/travis.suda-online.html','travis.suda.html')
 z.writestr('START-HERE.txt','Extract travis.suda.html and open it in Chrome. Enter moves or paste FEN/PGN, then click Find best move. Internet is required to download full Stockfish 19 (about 154 MB) on first analysis. Keep the page open. No extension or Developer mode is needed. Your district must allow local HTML and registry.npmjs.org.\\n')
`],{encoding:'utf8'});
if(zip.status!==0)throw new Error(zip.stderr||'Small ZIP packaging failed.');

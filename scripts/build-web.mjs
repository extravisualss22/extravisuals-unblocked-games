import { build } from 'esbuild';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const source = new URL('chess-assistant/', root);
const output = new URL('dist/', root);
await mkdir(output, { recursive: true });
const [template, css, worker, wasm, stockfishLicense, chessLicense] = await Promise.all([
  readFile(new URL('web.html', source), 'utf8'),
  readFile(new URL('web.css', source), 'utf8'),
  readFile(new URL('vendor/stockfish-19-single.js', source)),
  readFile(new URL('vendor/stockfish-19-single.wasm', source)),
  readFile(new URL('vendor/stockfish-LICENSE.txt', source), 'utf8'),
  readFile(new URL('vendor/chess-LICENSE.txt', source), 'utf8'),
]);
const result = await build({
  entryPoints: [fileURLToPath(new URL('web.js', source))],
  bundle: true, write: false, format: 'iife', platform: 'browser',
  target: 'chrome114', legalComments: 'inline', minify: false,
  // The embedded engine URL getter is used before this fallback is evaluated.
  define: { 'import.meta.url': JSON.stringify('file:///embedded-travis.suda/') },
});

const escapeHTML = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeScript = value => value.replace(/<\/script/gi, '<\\/script');
const bootstrap = `
// Decode the full engine only when analysis starts. No server or remote code.
(() => {
  let engineURL;
  let wasmURL;
  function decode(id, mime) {
    const element = document.getElementById(id);
    const text = element.textContent.trim();
    element.remove();
    const chunks = [];
    const length = 1024 * 1024;
    for (let start = 0; start < text.length; start += length) {
      const binary = atob(text.slice(start, start + length));
      const chunk = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) chunk[i] = binary.charCodeAt(i);
      chunks.push(chunk);
    }
    return URL.createObjectURL(new Blob(chunks, { type: mime }));
  }
  Object.defineProperty(globalThis, 'CHESS_ENGINE_URL', {
    configurable: false,
    get() {
      if (!engineURL) {
        wasmURL = decode('embedded-stockfish-wasm', 'application/wasm');
        engineURL = decode('embedded-stockfish-js', 'text/javascript');
      }
      return engineURL + '#' + encodeURIComponent(wasmURL);
    },
  });
  window.addEventListener('pagehide', () => {
    if (engineURL) URL.revokeObjectURL(engineURL);
    if (wasmURL) URL.revokeObjectURL(wasmURL);
  });
})();`;
const notices = `<details id="licenses" style="max-width:1100px;margin:24px auto;padding:16px;font:12px/1.6 system-ui"><summary>Licenses and source code</summary><p>This app includes the full, unchanged Stockfish.js 19.0.1 single-thread engine (GPL-3.0) and chess.js 1.4.0 (BSD-2-Clause). Its companion source is bundled unminified in this HTML file.</p><p><a href="https://github.com/nmrugg/stockfish.js/tree/v19.0.1">Exact Stockfish.js source and build instructions</a> · <a href="https://github.com/jhlywa/chess.js/tree/v1.4.0">chess.js source</a></p><h3>Stockfish / GPL-3.0</h3><pre style="white-space:pre-wrap">${escapeHTML(stockfishLicense)}</pre><h3>chess.js / BSD-2-Clause</h3><pre style="white-space:pre-wrap">${escapeHTML(chessLicense)}</pre></details>`;
const embedded = `
<script id="embedded-stockfish-wasm" type="application/octet-stream">${wasm.toString('base64')}</script>
<script id="embedded-stockfish-js" type="application/octet-stream">${worker.toString('base64')}</script>
<script>${escapeScript(bootstrap + '\n' + result.outputFiles[0].text)}</script>`;
let html = template
  .replace(/<link\b[^>]*href=["'](?:\.\/)?web\.css["'][^>]*>/i, `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
  .replace(/<script\b[^>]*src=["'](?:\.\/)?web\.js["'][^>]*>\s*<\/script>/i, embedded)
  .replace(/href=["'](?:\.\/)?README\.md["']/gi, 'href="#licenses"')
  .replace(/href=["']vendor\/stockfish-LICENSE\.txt["']/gi, 'href="#licenses"')
  .replace('</body>', `${notices}\n</body>`);
if (html.includes('src="./web.js"') || html.includes('href="./web.css"')) throw new Error('Failed to inline website assets.');
const policy = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; worker-src blob:; connect-src blob:; img-src data: blob:; media-src blob:; base-uri 'none'; object-src 'none'";
html = html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`);
const standalonePath = new URL('travis.suda.html', output);
await writeFile(standalonePath, html);

// Bundle the equivalent ordinary static website, ready for an HTTPS host.
const archivePath = fileURLToPath(new URL('chess-website.zip', output));
const files = [
  ['web.html', 'index.html'], ['web.css', 'web.css'], ['web.js', 'web.js'],
  ['engine.js', 'engine.js'], ['position.js', 'position.js'], ['capture.js', 'capture.js'],
  ['vendor/chess.js', 'vendor/chess.js'],
  ['vendor/stockfish-19-single.js', 'vendor/stockfish-19-single.js'],
  ['vendor/stockfish-19-single.wasm', 'vendor/stockfish-19-single.wasm'],
  ['vendor/chess-LICENSE.txt', 'vendor/chess-LICENSE.txt'],
  ['vendor/stockfish-LICENSE.txt', 'vendor/stockfish-LICENSE.txt'],
].map(([from, to]) => [fileURLToPath(new URL(from, source)), to]);
files.push([fileURLToPath(new URL('README-web.md', root)), 'README.md']);
const zip = spawnSync('python3', ['-c', 'import json,sys,zipfile\nargs=json.loads(sys.argv[1])\nwith zipfile.ZipFile(args["archive"],"w",zipfile.ZIP_DEFLATED,compresslevel=6) as z:\n for src,dest in args["files"]: z.write(src,dest)\n', JSON.stringify({ archive: archivePath, files })], {
  encoding: 'utf8',
});
if (zip.status !== 0) throw new Error(zip.stderr || 'Website ZIP packaging failed.');
for (const path of [fileURLToPath(standalonePath), archivePath]) {
  console.log(`${path} (${((await stat(path)).size / 1024 / 1024).toFixed(1)} MB)`);
}

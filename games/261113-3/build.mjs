// build.mjs — src/ と assets/ を 1 ファイルの index.html にまとめる（実行: node build.mjs）
//   試し見用: STORY=<別の story.js のパス> OUT=<出力 html のパス> node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = (f) => (f === 'story.js' && process.env.STORY ? process.env.STORY : path.join(dir, 'src', f));
const ORDER = ['layout.js', 'core.js', 'audio.js', 'world.js', 'vfx.js', 'dishes.js', 'story.js'];

const assets = {};
for (const f of fs.readdirSync(path.join(dir, 'assets')).sort()) {
  const ext = path.extname(f).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' ? 'image/jpeg' : null;
  if (!mime) continue;
  assets[path.basename(f, ext)] =
    `data:${mime};base64,` + fs.readFileSync(path.join(dir, 'assets', f)).toString('base64');
}

const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
let html = fs.readFileSync(path.join(dir, 'src', 'shell.html'), 'utf8');
const put = (mark, body) => {
  const i = html.indexOf(mark);
  if (i < 0) throw new Error('marker not found: ' + mark);
  html = html.slice(0, i) + body + html.slice(i + mark.length);
};
put('/*__THREE__*/', safe(fs.readFileSync(path.join(dir, 'src', 'three.min.js'), 'utf8')));
put('/*__ASSETS__*/', 'window.G_ASSETS=' + safe(JSON.stringify(assets)) + ';');
put('/*__CODE__*/', safe(ORDER.filter((f) => fs.existsSync(file(f)))
  .map((f) => `\n/* ---- ${f} ---- */\n` + fs.readFileSync(file(f), 'utf8')).join('\n')));
const out = process.env.OUT || path.join(dir, 'index.html');
fs.writeFileSync(out, html);
console.log(out, (html.length / 1024 / 1024).toFixed(2) + ' MB', Object.keys(assets).join(','));

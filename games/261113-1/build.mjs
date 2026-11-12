// build.mjs — src/ と assets/ を 1 ファイルの index.html にまとめる（実行: node build.mjs）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const ORDER = ['layout.js', 'core.js', 'audio.js', 'world.js', 'futon.js', 'props.js', 'story.js'];

const assets = {};
for (const f of fs.readdirSync(path.join(dir, 'assets')).sort()) {
  const ext = path.extname(f).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.jpg' ? 'image/jpeg' : null;
  if (!mime) continue;
  assets[path.basename(f, ext)] =
    `data:${mime};base64,` + fs.readFileSync(path.join(dir, 'assets', f)).toString('base64');
}

const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
let html = src('shell.html');
const put = (mark, body) => {
  const i = html.indexOf(mark);
  if (i < 0) throw new Error('marker not found: ' + mark);
  html = html.slice(0, i) + body + html.slice(i + mark.length);
};
put('/*__THREE__*/', safe(src('three.min.js')));
put('/*__ASSETS__*/', 'window.G_ASSETS=' + safe(JSON.stringify(assets)) + ';');
put('/*__CODE__*/', safe(ORDER.filter((f) => fs.existsSync(path.join(dir, 'src', f))).map((f) => `\n/* ---- ${f} ---- */\n` + src(f)).join('\n')));
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log('index.html', (html.length / 1024 / 1024).toFixed(2) + ' MB', Object.keys(assets).join(','));

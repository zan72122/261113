// node build.mjs  ->  index.html (everything inlined)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const ORDER = ['vendor/three.min.js', 'engine.js', 'audio.js', 'hands.js', 'rice.js', 'props.js',
  'world.js', 'scenes_a.js', 'scenes_b.js', 'main.js'];

let html = fs.readFileSync(path.join(src, 'index.template.html'), 'utf8');
const parts = [];
for (const f of ORDER) {
  const p = path.join(src, f);
  if (!fs.existsSync(p)) { console.log('  skip (missing) ' + f); continue; }
  const code = fs.readFileSync(p, 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  parts.push('<script>/* ' + f + ' */\n' + code + '\n</script>');
  console.log('  + ' + f + '  ' + (Buffer.byteLength(code) / 1024).toFixed(1) + ' KB');
}
const fb = path.join(src, 'fallback.jpg');
let dataUri = 'data:image/gif;base64,R0lGODlhAQABAIAAAMmiegAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
if (fs.existsSync(fb)) dataUri = 'data:image/jpeg;base64,' + fs.readFileSync(fb).toString('base64');
else console.log('  (no src/fallback.jpg — using a 1px warm placeholder)');

// use function replacers so "$" in code is never interpreted
html = html.replace('<!--FALLBACK_DATAURI-->', () => dataUri);
html = html.replace('<!--SCRIPTS-->', () => parts.join('\n'));
const out = path.join(root, 'index.html');
fs.writeFileSync(out, html);
console.log('wrote ' + out + '  ' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB');

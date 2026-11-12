// tools/shot.mjs — 作った html を 1 枚撮る（制作時の見た目確認用。ゲーム本体には入らない）
//   node tools/shot.mjs <html> <out.png> [--wait 1500] [--size 390x844] [--eval "JS を実行してから撮る"] [--after 400]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const html = path.resolve(a[0]), out = path.resolve(a[1]);
const [w, h] = opt('size', '390x844').split('x').map(Number);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('file://' + html);
await page.waitForTimeout(Number(opt('wait', 1500)));
const ev = opt('eval', '');
if (ev) {
  try { const r = await page.evaluate(ev); if (r !== undefined) console.log('eval →', JSON.stringify(r)); }
  catch (e) { console.log('[eval error]', e.message); }
  await page.waitForTimeout(Number(opt('after', 400)));
}
await page.screenshot({ path: out });
await browser.close();
console.log('shot', out);

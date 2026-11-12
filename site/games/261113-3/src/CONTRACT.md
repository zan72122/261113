# きゅっきゅっ！おさらをふいてしまおう — 共通契約（gf-261113-nx3）

5歳の子が iPhone / iPad で、指1本だけで遊ぶ、文字のいらない 3D ゲーム。1ファイルの `index.html` にまとめる。
**見た目は「本物どおり、ふつうの見た目」の写実 3D**（日本のふつうの家の台所と食卓）。おもちゃ風・ローポリ・絵本風・シュール・不気味は禁止。
人物・動物は出さない（家族は「席・椅子の大きさ・箸・色」で表す）。文字・数字はどこにも描かない（時計にも数字なし）。

## お話（1周）
1. **すすぐ（前）** 夕方の台所。シンクにあわあわの食器が5つ。蛇口のレバーを上げると水が出て、あわが流れてシャボン玉が浮く。レバーを下げて止めると、食器が水切りかごへ移る。
2. **ふく（中心）** かごの食器を1つタップ → ふきマットの上へ。ふきんで きゅっきゅっ となぞると、水滴が消えて、ふき終わると キラーン と光る。
3. **しまう（中心）** 光った食卓の席へ、食器を指で運んで置く（ことん）。大皿→おとうさんの大きい茶わん→おかあさんの茶わん→わたしの小さい茶わん→コップ。置くたびに外が少しずつ暮れる。
4. **あかり（後）** 5つ並ぶと部屋はうす暗い。ペンダントライトのひもを引くと、ぱっと明るくなり食器がきらめく。
5. **ごはん（後）** ほかほかのごはんが並ぶ（おとうさんの茶わんだけ山盛り）。タップで ぱくっ と食べる。全部食べたら ごちそうさま。
6. **かたづけ（やさしい終わり → くりかえし）** 空の食器をタップするとシンクへ戻り、つぎの日の夕方になって 1 へ。

## 全モジュール共通のきまり
- ふつうの `<script>`（モジュールではない）。各ファイルは `(function(){ 'use strict'; var G = window.G = window.G || {}; ... })();`。
- three.js **r149** がグローバル `THREE`（`src/three.min.js`、本体のみ）。examples の追加物（RoomEnvironment, RoundedBoxGeometry, GLTFLoader, OrbitControls 等）は**無い**。`renderer.outputEncoding = sRGBEncoding`、`toneMapping = ACESFilmic`、色テクスチャは `tex.encoding = THREE.sRGBEncoding`。
- 読み込み時（IIFE 直下）に THREE のオブジェクトを作らない・例外を出さない。作るのは `build()` の中。
- 毎フレームの処理は `G.onUpdate(fn(dt, time))`。時間待ちは `G.after(sec, fn)` / `G.tween(sec, fn(k), {ease, onDone})`（`setTimeout` は使わない。非表示中は止まる）。
- ほかのモジュールを呼ぶ時は存在を確かめる（例: `if (G.audio && G.audio.play) G.audio.play('clink')`）。相手が無くても落ちない。
- 毎フレームのループ内で `new` をなるべくしない。粒は `G.quality.maxParticles`（通常 300 / 低負荷 140）を超えない。`G.onQuality(fn)` で低負荷モードに応じる。
- 外部読み込み・外部素材・CDN なし。画像は `G.assets.tex(name, {repeat:[u,v], mirror, srgb, aniso})`（`assets/` の `wood` `wall` `linen` `backdrop`）か、canvas で手続き的に作る。
- 単位 m、Y 上。位置・寸法は必ず `G.L`（`src/layout.js`）から取る。カメラは +z 側から -z を見る。
- 対象は iPad で 30fps。影を落とす光は world.js の 2 つまで。透過 (`transmission`) は使わない。

## core.js（既存・変更しない）
`G.boot(startFn)` / `G.scene` `G.camera` `G.renderer` `G.canvas` `G.time` / `G.onUpdate` `G.onResize` `G.quality` `G.onQuality`
`G.util`: clamp lerp smooth damp rand easeOutBack easeOutCubic easeInOutCubic / `new G.Spring({x,k,c})` → `.x .v .target .step(dt) .kick(v)`
`G.tween` `G.after` → `{cancel()}` / `G.assets.tex` `G.assets.has`
`G.input.on('down'|'move'|'up', fn(p))` — p = `{x,y (CSS px), nx,ny (-1..1, 上が+), dx,dy, vx,vy (px/s), moved, time}`。最初の1本の指だけ。
`G.screenRay(nx,ny)` → THREE.Ray（使い回し。保持しない） / `G.toScreen(vec3, out)` → `{x,y,behind}` / `G.screenDist(p, vec3)` → 指と点の画面上の距離(px)
`G.cam.setView(view, {sec, ease, onDone})` — view = `{look:[x,y,z], dir:[x,y,z], w, h, fovP, fovL}`（look を中心に幅 w・高さ h が必ず画面に入る距離をとる）
`G.cam.shake(amount)` / `G.fx.flash(cssColor, peak, inSec, outSec, atPeak)` — 画面全体のやわらかい色フェード
`G.hint.set({at:()=>Vector3|null, to:()=>Vector3, gesture:'tap'|'hold'|'drag', glow:(g)=>{}, wiggle:()=>{}})` / `G.hint.clear()` — 光の輪ときらめきを at に常に出し、3.5 秒放置で wiggle、7.5 秒で半透明の指のお手本。
`G.save.get(key, def)` / `G.save.set(key, value)`

## world.js → `G.world`（部屋・家具・光。動かない物すべて）
```
build()                      1回だけ。G.scene に追加。光・影・環境マップ（scene.environment）も用意
setDusk(k, sec)              k: 0=夕方の金色の光 … 1=日が暮れてうす暗い青。sec（既定 2）かけて変わる。窓の外の空・室内の光が連動
dusk                         今の値
faucet.setLever(k)           0=閉（レバー下）… 1=開（レバー上）。見た目だけ、即時
faucet.leverPos(out)         レバーの先の世界座標（Vector3 を返す）
faucet.mouthPos(out)         吐水口の世界座標
faucet.wiggle()              レバーがぴくっと揺れる
lamp.setOn(on, instant)      ペンダントライトを点ける/消す（電球・かさ・食卓への暖かい光と影）
lamp.on                      bool
lamp.setPull(d)              ひもを d(0..1)×G.L.lamp.pull だけ引き下げた見た目。0 に戻すとばねで少し揺れて戻る
lamp.knobPos(out)            ひもの先の玉の今の世界座標
lamp.kick(v)                 かさとひもが少し揺れる
spotPos(id, out)             食器 id を置く、食卓の天板上の世界座標（y = 天板の上面）
seatReact(id)                その席の箸などが小さく跳ねる（食器が置かれた時）
```
食器・水・泡・きらめきは world では作らない。

## vfx.js → `G.vfx`（水・泡・湯気・きらめき）
```
build()
water.setFlow(k)             0..1。吐水口から真下へ落ちる水の柱 + 当たった所のしぶき + 流しの底の波紋
water.hitY                   水が当たる高さ（既定 G.L.sink.floorY + 0.05）。外から書き換え可
bubbles.emit(pos, n)         シャボン玉が pos からふわふわ上がる。同時 14 個まで。4〜7 秒で自然に割れる
bubbles.popAt(p)             指 p（input の p）にいちばん近い玉（画面上 50px 以内）を割る → 割れたら true
steam.add(pos, scale)        湯気を出し続ける → {stop()}    / steam.clear()
sparkle(pos, {n, spread, size})   4 点星のきらめきが n 個はじける（約 0.7 秒）
glint(pos, size)             大きな星のまたたき 1 つ + 細い光条（約 0.6 秒）「キラーン」
spot.show(pos, radius) / spot.hide()   水平な面の上に、暖かく脈打つ光の輪（置き場所の目印）
drip(pos, floorY)            水のしずくが 1 つ落ち、floorY で小さくはねる
```

## dishes.js → `G.dishes`（食器5つ・ぬれ/ふき・ふきん・あわ・ごはん）
```
build()
ids / list / get(id)
wipeView(id)                 その食器をマットの上でふく時のカメラ view（{look,dir,w,h,fovP,fovL}）
Dish:
  id, group(THREE.Group), r, h
  where                      'sink' | 'rack' | 'mat' | 'carry' | 'spot'
  toSink(o) toRack(o) toMat(o) toSpot(o)    o = {instant, sec, delay, onDone}。弧を描いて移動し、着いたら where を更新（音は story が鳴らす）
  beginCarry()               where='carry'。少し持ち上がる
  carryTo(x, z)              carry 中: 指の下の世界 x,z へ（少し遅れて・速さで傾く）。高さは下の面（天板/食卓）に合わせて dish が決める
  center(out)                見た目の中心の世界座標（ヒント・当たり判定用）
  setFoam(k)                 0..1 せっけんの泡の量
  setWet(k)                  1=全面ぬれ（水滴 + くもった水の膜）にリセット / 0=即かわいた状態
  dryness()                  0..1
  wipeBegin(p) wipeMove(p) wipeEnd()   p は input の p。ふきんが指の下へ来て食器の面をふく。
                             wipeMove → {dried: 今回新しく乾いた割合, moved: ふきんが動いた距離(m), speed: m/s}
  finishDry()                残りの水滴を消し、ぴかぴかにして、光が面を横切る
  shiny / setShiny(b)
  setGlow(g)                 0..1 ヒントの光（やわらかい発光）
  wiggle() / hop(h)          その場でかたかた / ぴょん
  serve()                    ごはんが盛られる（foodLeft = foodMax）
  bite()                     ひと口へる → 残り foodLeft
  foodLeft / foodMax
  setDirty(k)                0..1 食べ終わりのよごれ
```

## audio.js → `G.audio`（Web Audio の合成音のみ）
`unlock()` `suspend()` `resume()` `play(name, {vol, pitch, pan, delay})` `loop(name, level)` `amb(name, sec)` `music(name)` `stopMusic(sec)`
- 単発: `leverClick` `drip` `pop` `foam` `clink`(陶器) `glassTing` `pickup` `clothThud` `squeak`(きゅっ) `dropDodge` `dropCatch` `kira` `kiraSoft` `koton` `whoosh` `lampClick` `lampOn` `itadaki` `paku` `gokku` `gochiso` `hint` `sparkle`
- 持続: `water` `rub` `fizz` / 環境: `kitchen` `dusk` `dinner` `none` / 音楽: `dinner` `night`

## story.js（進行・入力・ヒント・カメラ・保存）
`G.boot(start)` を呼ぶ。上の API だけを使って 1〜6 を進める。

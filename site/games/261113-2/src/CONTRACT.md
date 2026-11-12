# にぎにぎ！ママとおなじおにぎり — 設計と共通契約 (gf-261113-nx2)

5歳児が指1本で遊ぶ、文字なし・失敗なしの写実3D Webゲーム。最終成果物は `games/261113-2/index.html` 1ファイル（全部埋め込み）。
このファイルは全実装役が守る共通の約束。**自分の担当ファイル以外は編集しない。**

## 0. 体験の核
台所のカウンターを、子どもの目線（上から約60°見下ろし）で見る。ママは子どもの後ろに立ち、両腕を左右から回している（画面下の左右の角からママの腕、下の中央から子どもの腕が入る。顔・体は映らない）。
- 奥: 炊飯器 → その手前: 具の小皿3つがのった細長い盆 → ママのまな板 → 子どものまな板（いちばん手前）。
- **核の仕組み**: ごはんの塊をまな板に置き、両手を左右の「壁」にしてはさむ。真上から見た**両手の形がそのままおにぎりの形になる**。
  - `| |` まっすぐ平行 (t=0) → たわら形（角丸の長方形・スタジアム形）
  - `/ \` 指先を合わせた山 (t=0.5) → さんかく
  - `( )` 丸くかこむ (t=1) → まる
  - ママがまず自分の手でやって見せる。子どもは手を同じ形にして、ごはんを「ぎゅっ」と押す。どの形でも正解（失敗なし）。同じ形だと特別にうれしい演出。

## 1. お話（場面の流れ）
- S0 ふた: 炊飯器の湯気。ふたのボタンが光る → 押すとふたが開き、湯気とつやつやごはん。
- S1 よそう: ママが先にしゃもじで自分のまな板へ（お手本）。しゃもじが光る → 子どもが釜からまな板へ運ぶ（ドラッグ）。
- S2 ぐ: 小皿3つ（うめ・しゃけ・こんぶ）が光る → 1つをごはんのくぼみへ運ぶ。
- S3 かたち+にぎる（中心）: ママの手が形を作って にぎってみせる → 子どもの手の指先が光る → 手を寄せて形を作る → ごはんが光る → 押して「ぎゅっ」×数回 → 完成。
- S4 のり: ママの手がのりを差し出す → 受け取っておにぎりへ。
- S5 おさら: 盆が左へ、大皿が右から入る。ママのおにぎりの隣（光る場所）へ自分のを運ぶ。
- S6 ちび: まな板に残ったごはん粒の小さな塊が光る → 押すと「ぽんっ」と ちびおにぎり → 皿へ。大・中・ちびの3つが並ぶ（くすっと笑える所）。
- S7 たべる: 自分のおにぎりを触ると、手が手前（画面下の外）へ運び「もぐもぐ」→ かじり跡と中の具が見える。うめは「すっぱい！」で手がぶるぶる。食べ終わるとママの手がハイタッチを求める → タッチ → やさしい光と音でおしまい。少しすると炊飯器のボタンがまた光り、次の回はママの形が変わる。ちびおにぎりは皿に残り続ける（保存）。

## 2. 技術の約束
- クラシックスクリプト（ES modules 禁止）。`three.min.js` r160 のグローバル `THREE`。各ファイルは IIFE で `window.G`（`window.G = window.G || {}`）に生やす。
- 読み込み順: `vendor/three.min.js`, `engine.js`, `audio.js`, `hands.js`, `rice.js`, `props.js`, `world.js`, `scenes_a.js`, `scenes_b.js`, `main.js`
- 外部読み込み一切なし（CDN・画像・音ファイル・フォント禁止）。テクスチャは canvas で手続き生成（色テクスチャは `colorSpace = THREE.SRGBColorSpace`）。テクスチャは最大1024px。
- 単位はメートル。カウンター上面が y=0。**+X = 画面右、-Z = 画面上（奥）、+Z = 画面下（手前・子ども側）、+Y = 上**。
- 見た目は「本物どおり、ふつうの見た目」の写実。おもちゃ風・ローポリ・絵本風・シュール・不気味は禁止。面はなめらかに（十分な分割、スムーズシェーディング）、材質は PBR（MeshStandardMaterial / MeshPhysicalMaterial）で実物の粗さ・色に。
- 文字・数字・記号を画面に出さない（炊飯器の表示パネルも数字なしの暗いパネル＋LED点だけ）。
- 動物・キャラクター・顔は出さない。
- iPad で 30fps 目標。ドローコールと頂点数は控えめに（1モジュールの常時表示分で目安 6万三角形以下、マテリアルは共有）。毎フレームのジオメトリ再生成は、状態が変わった時だけ。
- 時間は必ずエンジンの時計（`G.tween` / `G.wait` / update の dt）で進める。`setTimeout` / `setInterval` は使わない（非表示で止まるように）。
- `G.quality.tier` は `'high' | 'low'`。low では影なし・粒子少なめ・テクスチャ512。
- どの関数も、未ロードの他モジュールや失敗（音の拒否・保存の拒否）で例外を投げない。
- 自分の見た目確認用のプレビューHTML・スクリーンショットは **スクラッチパッド**（`/tmp/claude-0/-home-user-261113/e77440c6-1320-5b31-b826-c5d3a7ad6f8a/scratchpad/<自分のモジュール名>/`）に置き、リポジトリには入れない。Playwright は導入済み（`require('playwright')`、`chromium.launch()`。WebGL が取れなければ `args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']`）。`file://` で絶対パスの `<script src>` を並べれば動く。
- git の commit / push はしない（司令塔がやる）。テストスイートやテスト用の仕組みは作らない。

## 3. モジュール API

### engine.js（担当: エンジン役）
- `G.Engine.init(canvas) -> boolean`（WebGL失敗で false）。`G.scene`, `G.camera`, `G.renderer`, `G.quality`, `G.time`（秒・ゲーム時計）。
- ライト: 窓からの暖かい朝の日差し（左奥上からの DirectionalLight、ソフトシャドウ）＋やわらかい環境光＋手続き生成の環境マップ（PMREM）。ACES トーンマッピング、sRGB 出力。
- `G.Engine.onUpdate(fn(dt, time))`, `G.Engine.onResize(fn(w,h))`, `G.Engine.start()`。dt は 0.05 で上限。非表示(visibilitychange/pagehide/blur)で停止、復帰で時計を飛ばさず再開。
- 動的解像度（フレーム時間を見て pixelRatio を 0.6〜上限で上下、上限は high=2, low=1.5）。遅さが続けば low へ落とす（影OFF）。
- カメラ: `G.Cam.frame({cx, cz, w, d, pitch=60, dur=1.0, pad=0.06})` — カウンター上の長方形（中心 (cx,0,cz)、X幅 w、Z奥行 d）が縦横どちらの画面でも Safe Area 内に収まる距離を計算して、イージングで移動。リサイズ・回転時は現在の枠で再計算。`G.Cam.shake(amount, dur)`。`G.Cam.current`（今の枠）。
- 入力: Pointer Events、最初の1本の指だけ追跡（他の指は無視、pointercancel は up 扱い）。
  - `G.Input.on('down'|'move'|'up', fn(ev))`, `G.Input.off(...)`。`ev = {x, y, id, ray:THREE.Ray, onPlane(y)->Vector3|null, time, dx, dy, moved(px総移動), duration}`。
  - `G.Input.pick(ev, object3D | [object3D...]) -> {object, point, distance} | null`（レイキャスト、再帰）。
  - `G.Input.screenDist(ev, worldVec3) -> px`（大きな当たり判定用。画面上の距離）。
  - `G.Input.project(worldVec3) -> {x,y}`（CSS px）。
- トゥイーン: `G.tween(target, {prop: to, ...}, dur, {ease, delay, onUpdate(k), onDone})`（数値プロパティ。`target` が Vector3/Euler/任意オブジェクト可）戻り値 `{kill()}`。`G.wait(sec, fn) -> {kill()}`。`G.killTweens(target)`。`G.Ease = {linear, in, out, inOut, outBack, outElastic, outBounce}`。`G.lerp, G.clamp, G.smooth(cur, target, rate, dt)`（指数追従）。
- 演出: 
  - `G.FX.steam(getPosFn | Vector3, {rate=6, size=0.05, rise=0.25, life=1.6}) -> {stop(), setRate(n)}`（やわらかい白い湯気）。`G.FX.puff(pos, {count, size})` 一発の湯気。
  - `G.FX.burst(pos, {count=14, kind:'sparkle'|'grain'|'crumb', color, speed, size})`。
  - `G.FX.halo(getPosFn | Object3D, {radius=0.05, color=0xfff2b0, y=0.002}) -> {setStrength(0..1.5), dispose()}` — 対象の下/周りに呼吸する柔らかい光の輪（加算スプライト、世界の中）。
  - `G.FX.pulse(object3D, {color=0xffd070, strength=0.5}) -> {setStrength(v), stop()}` — メッシュの emissive をやさしく脈動（元の値を保存して復元）。
  - 粒子は全体で上限（high 220 / low 90）。
- ヒント（次の1操作の案内。放置で段階的に強める）:
  - `G.Hint.set({kind:'tap'|'press'|'drag', at: fn->Vector3, to: fn->Vector3 (dragのみ), object: Object3D (任意。pulse対象), radius, onLevel(level)})`
  - `G.Hint.clear()`, `G.Hint.poke()`（ユーザー操作があったら呼ぶ。放置タイマーを戻す）。
  - 段階: L0 即時=halo と pulse の弱い呼吸 / L1 (4秒放置)=強い呼吸＋`G.Audio.play('ping')`＋`onLevel(1)` / L2 (8秒放置)=半透明の子どもの指（`G.Hands.createGhost()` があれば使用、無ければ簡易の半透明カプセル指）が世界の中でお手本（tap: 近づいて押す、press: 押し続ける、drag: at→to をなぞる）を繰り返す＋`onLevel(2)`。操作が始まったら即 L0 に戻る。
- 保存: `G.Save.get() -> object`（壊れていても `{}`）、`G.Save.set(patchObject)`（例外を握りつぶす）。キー `gf-261113-2`。
- 進行: `G.Director.add(name, {enter(), update(dt), exit()})`, `G.Director.go(name)`, `G.Director.current`。
- フォールバック: WebGL失敗時は `#fallback`（埋め込み静止画）を表示。

### audio.js（担当: 音役）
- すべて Web Audio の合成。`G.Audio.unlock()`（最初のタッチで呼ばれる。失敗しても無視）、`G.Audio.suspend()`, `G.Audio.resume()`。
- `G.Audio.play(name, {vol=1, pitch=1, pan=0, delay=0})`。名前: `tap, button, lidOpen, lidClose, steam, scoop, plop, pick, drop, slide, tick, squish, release, match, done, nori, plate, pop, munch, sour, yum, clap, ping, sparkle, whoosh, sip, ending`
- 連続音: `G.Audio.squeezeStart()`, `G.Audio.squeezeSet(p 0..1)`, `G.Audio.squeezeEnd()`（押し込みに追従する ぎゅー という柔らかい音）。
- `G.Audio.ambience(on)`（とても小さい台所の空気音）、`G.Audio.music(on)`（小さな音量のやさしいカリンバ風の生成メロディ、長調ペンタトニック）。
- コンテキストが無い/止まっている時は全メソッドが無音で何もしない。

### hands.js（担当: 手役）
- `G.Hands.create({who:'child'|'mama', side:'L'|'R'}) -> hand`
  - `hand.group`（scene に add する。原点=世界原点のまま）、`hand.root`（手首フレーム。`hand.group` の子。位置・回転は世界座標と同じ扱い）。
  - **手首フレームの向き**: 原点=手首の中心。指は **-Z** へ伸びる。手のひらの面は **-Y**（平らに机へ置くと手のひらが下）。前腕は +Z 側。右手('R')の親指は **-X** 側、左手は鏡像（+X 側）。
  - 腕: 手首から `hand.elbow`（世界座標 Vector3、画面外の固定点。who/side ごとの既定値あり、変更可）へ向けて、肌の前腕（子ども約0.16m、ママ約0.22m）＋その先を画面外まで続く袖（子ども: やわらかい黄色の長袖Tシャツ、ママ: 生成りのリネンシャツの袖、まくった折り返し）で毎フレームつなぐ。既定の elbow: 子ども (±0.09, 0.30, 0.62)、ママ (±0.36, 0.42, 0.60)（L が -X）。
  - 寸法 `hand.dims = {length, width, thick, palmLen}`（ママ: 手首〜中指先 約0.170、幅 約0.080 / 子ども: 約0.115、幅 約0.058、ふっくら短い指）。
  - ポーズ: `hand.setPose(nameOrObj, dur=0.25)`（なめらかに補間）、`hand.pose`（現在値）。ポーズ値 `{curl:[人,中,薬,小] 0..1, spread:-1..1, thumbOut:0..1, thumbCurl:0..1}`。プリセット `G.Hands.POSES`: `relaxed, flat, wall（指をそろえてまっすぐ、親指は人差し指の脇に添える）, cup（全体を丸くカーブ）, point（人差し指だけ伸ばす）, pinch（親指と人差し指の先を合わせる）, grip（直径2.5cmの柄を握る）, hold（おにぎり大の物を上からつかむ）, open（指を開いたパー）, fist`。
  - アンカー（ポーズに追従する Object3D）: `hand.anchors.palm`（手のひら中央の表面）、`.grip`（握った柄の中心。柄の軸は手のX方向）、`.pinch`（親指と人差し指の先の間）、`.indexTip`、`.midTip`。
  - `hand.setGlow(v 0..1)`（指先があたたかく光る＝「ここを動かす」の合図）、`hand.setGrains(n 0..8)`（手についたごはん粒を表示）。
  - 動きの補助（エンジンの `G.tween` を使う）: 
    - `hand.moveTo({pos:Vector3, rot:Euler|Quaternion, pose, dur=0.4, ease, onDone})`（手首を移動。少し山なりの軌道）
    - `hand.rest(dur=0.5)`（画面下の端近くの待機位置へ。子ども: (±0.075, 0.04, 0.33) 付近で指先だけ少し見える位置、ママ: (±0.215, 0.07, 0.20) 付近、relaxed）。`hand.restPos`, `hand.restRot` は変更可。
    - `hand.hide(dur)`, `hand.show(dur)`（画面外へ引っ込む/戻る）
    - `hand.attach(object3D, anchorName)` / `hand.detach(object3D, parent)`（物をアンカーに付け外し。世界姿勢を保つ）
    - `hand.idle = true|false`（待機中の微かな揺れ）
  - `hand.update(dt)` は hands.js が `G.Engine.onUpdate` に自分で登録して回す。
- `G.Hands.createGhost() -> {group, tip:Object3D, setOpacity(v), setPress(p 0..1)}` — ヒント用の半透明（不透明度0.45程度）の子どもの右手（point ポーズ、前腕は短くフェード）。`group` の原点=人差し指の先。指先が -Z（画面上）を向き、手は手前下（+Z）から来る。
- 合格の見え方: カメラ（上から60°、距離0.8m前後）で見て、ふつうの人の手に見える。関節の継ぎ目・ロボット感・マネキン感・不気味さがない。肌はやわらかく、指先と関節がほんのり赤い。爪がある。子どもの手はふっくら小さい。

### rice.js（担当: ごはん役）
- 輪郭の約束: 角度 θ のとき `x = r·cosθ, z = -r·sinθ`（θ=90° が -Z=画面上）。輪郭は `N=64` 個の半径の配列（単位円基準の比率、面積が一定になるよう正規化）。
- `G.Rice.targetOutline(t) -> Float32Array(64)` — t=0 たわら（長軸が Z のスタジアム形、縦横比 約1.35）、t=0.5 さんかく（頂点が -Z、角は丸い、ほぼ正三角形）、t=1 まる。間は連続に補間。
- `G.Rice.createBody({size=0.032, kind:'lump'}) -> body`
  - `body.group`（原点=底面の中心。ごはんは板の上に横たわり、輪郭は XZ 平面、厚みが Y）。
  - 状態: `body.outline`（Float32Array 64）、`body.size`（等価半径 m）、`body.formed` 0..1（0=よそったままのふんわり不揃いな山、1=きれいに握られた形: 上面がほぼ平らで縁が丸い、厚み 約 size×0.95）、`body.t`（最後に握った形）、`body.filling`, `body.nori` 0..1, `body.bites`。
  - `body.squeeze(t, amount)` — 輪郭を `targetOutline(t)` へ amount (0..1) だけ寄せ、formed を進めて再構築。
  - `body.setPress(p 0..1)` — 押している間の一時的な変形（横に 8% 縮み、上に少し膨らむ）。軽い処理で。
  - `body.setSize(size)`、`body.rebuild()`。
  - `body.setFilling(kind|null)` — `'ume'|'sake'|'kombu'`。formed<0.25 の間は上面中央のくぼみに具が見える。握ると中に隠れる。
  - `body.setNori(v 0..1)` — のりの帯が手前の縁（+Z 側、θ=270°）の下から上面の中央あたりまで巻きつく進行。帯の幅は 約 size×0.95。のりは黒緑でわずかな艶と細かい凹凸。
  - `body.bite() -> boolean` — 奥側（-Z、頂点側）から丸くかじり取る。1回目: 小さなかじり跡、2回目: 中の具の断面が見える、3回目: 食べ終わり（true を返し、非表示）。断面はごはんの粒感。
  - `body.serialize() -> plain object`, `G.Rice.fromData(obj) -> body`。
- `G.Rice.createFillingPiece(kind) -> Object3D`（運ぶ用の一口分。うめ=しわのある赤い梅干し 直径約1.8cm、しゃけ=ほぐした鮭のかたまり、こんぶ=つやのある黒い佃煮のかたまり。原点=底）
- `G.Rice.createFillingHeap(kind) -> Object3D`（小皿に盛る分。直径 約4.5cm）
- `G.Rice.createNoriStrip({width, length}) -> Object3D`（平らに置いた のり の帯。原点=中心の底）
- `G.Rice.createScoop(size=0.03) -> Object3D`（しゃもじにのる ごはんの山。原点=底）
- `G.Rice.createPotRice(radius) -> {group, dig()}`（釜の中のごはんの面。つやつや・粒立ち。`dig()` で すくった跡が1つ増える）
- `G.Rice.createGrain() -> Mesh`（1粒）、`G.Rice.material`（共有のごはん材質）。
- 合格の見え方: 炊きたての白いごはんに見える（粒が立ち、ほんのり艶、真っ白すぎない）。握る前はふんわり不揃い、握ると輪郭がきれいで粒感は残る。プラスチックや雪玉に見えない。

### props.js（担当: 道具役）
`G.Props.build() -> props`（scene には add しない。各 Group の原点=底面中心で y=0 に置けばカウンターにのる。正面は +Z）
- `props.counter` — 明るい木の天板（オーク系、2.4m 角以上、木目・わずかな艶）。影を受ける。
- `props.cooker` — 家庭用の白い炊飯器（幅0.25×奥行0.30×高さ0.21、角の丸い箱形、上面にふた）。`setLid(v 0..1)`（奥の蝶番で開く。1 で約95°）、`button`（ふた手前上面の丸い大きなボタン Mesh。直径 約4.5cm。pick 用）、`pressButton(p 0..1)`、`ledOn(bool)`、`steamAnchor`（蒸気口の Object3D）、`potAnchor`（内釜のごはん面の中心の Object3D）、`potRadius`。内釜は暗いフッ素加工、中のごはんは `G.Rice.createPotRice` があれば使い `cooker.potRice` に保持（無ければ白い面で代用）。
- `props.shamoji` — 白いしゃもじ（全長0.20、原点=すくう面の中心、柄は +Z へ）。`handleAnchor`（柄の中央）、`bladeAnchor`（ごはんをのせる位置）。
- `props.boardMama`（0.27×0.18）, `props.boardChild`（0.23×0.16）— 木のまな板（角丸、厚み 約1.2cm）。`topY`。
- `props.tray` — 細長い木の盆（0.30×0.095）に白い豆皿3つ（直径 約7cm）。`dishes = [{kind:'ume'|'sake'|'kombu', anchor:Object3D（皿の中央・具の底の高さ）}]` 左から うめ・しゃけ・こんぶ。具の山は `G.Rice.createFillingHeap` があれば使う。
- `props.plate` — 大皿（直径0.27、白い陶器に淡い青の縁、緑の笹の葉を1枚敷く）。`slots = {mama, child, tiny:[5個]}`（ローカル座標の Object3D。mama は左、child は右、tiny は手前の縁沿い）。
- `props.cups` — 湯のみ2つ（大・小、緑茶入り）。`steamAnchors[2]`。
- 合格の見え方: 実物の台所道具に見える（材質感・面取り・サイズ感）。上から60°で見て、何であるかが一目で分かる。

### world.js（担当: エンジン役）
`G.W` — 配置と共有状態。`G.W.build()` が Props/Hands/Rice を生成して scene に置く。
- 配置（x, z）: 炊飯器 (0, -0.63) / 盆 (0, -0.345) / ママのまな板 (0, -0.135) / 子どものまな板 (0, 0.095) / しゃもじ (0.165, -0.56) / 大皿（0.92倍）最初は画面外 `P.plateOut` (1.0, -0.345)、S5 で `P.plateIn` (0, -0.345) へ / 盆は S5 で `P.trayOut` (-1.0, -0.345) へ / 湯のみは使わない（非表示のまま）。**位置は必ず `G.W.P` と実物の world 位置から取る（数値を直書きしない）。**
- `G.W.P = {cooker, tray, boardM, boardC, plateIn, plateOut, trayOut, ...}`（Vector3 の定数）。
- `G.W.props`, `G.W.hands = {cL, cR, mL, mR}`, `G.W.riceC`, `G.W.riceM`, `G.W.riceTiny`（body か null）, `G.W.minis`（過去のちびおにぎり body の配列）。
- `G.W.state = {round, mamaT, t, filling, mamaFilling, scoops, grains, ...}`、`G.W.SHAPES = [0.5, 1, 0]`（回ごとのママの形）。
- 枠: `G.W.FRAMES = {cooker, scoop, fill, shape, nori, plate, eat}`（`G.Cam.frame` に渡す長方形）。
- `G.W.resetRound()` — 次の回のために盤面を戻す（ふたを閉める、まな板を空に、盆と皿を元へ、手を待機へ。ちびおにぎりは残す）。

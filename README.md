# NOT RESPONDING

深夜 02:47、自分の部屋。机の上の PC が、止まらない。

ブラウザで遊ぶ短編一人称ホラー／グリッチ体験（約10〜15分）。Three.js + React + Web Audio で、映像・音・入力・UI をすべて同期させています。フェードや場面転換カットに頼らず、ひと続きのカメラで「自室 → モニターの内側 → 異世界 → 崩壊 → 自室」を移動します。

## 遊び方

`npm install` → `npm run dev`（配信は `npm run build` + `npm run preview`）。WebGL2 対応ブラウザが必要です。

1. 自室。机の PC に近づき、`E` で調べる。視点がモニターへ寄り、青い `:(` の画面になります。
2. `:(` をクリック（何度でも）。クリックするほど画面が崩れ、部屋の光と空間が歪み、やがて体内へ引き込まれます。
3. 異世界。地形、霧、構造物、浮遊するエラーウィンドウ。中心の構造物には脱出の手掛かりが刻まれています。
4. `C` でゲーム内コンソールを開く。手掛かりの言葉を入力すると崩壊が始まり、視点は強制的に操られ、床が割れ、瓦礫とともに落下します。
5. 落ちた先は、元の部屋。異変の残る部屋を歩き回れます。モニターに触れるか `R` で、もう一度。

## 操作

| キー | 動作 |
| --- | --- |
| `WASD` / 矢印 | 移動 |
| `Shift` | 走る |
| マウス | 視点（Pointer Lock が使えない環境ではドラッグ） |
| `E` / `F` | 調べる |
| クリック / `Space` | 画面の顔に触れる |
| `Q` | モニターから離れる（崩壊前のみ） |
| `C` | コンソール（異世界のみ） |
| `Enter` | コマンド実行 |
| `Esc` | ポーズ / コンソールを閉じる |
| `M` | ミュート |
| `R` | 帰還後、もう一度 |

タッチ端末では画面ドラッグで視点、左下のスティックで移動、右下のボタンで調べる／コンソール。

## 構成

- `src/App.tsx` — 起動シーケンス（アセット読み込み → エンジン生成）、タイトル、HUD、コンソール、ポーズ、設定の保存
- `src/ui/` — `hud.tsx`（照準・プロンプト・字幕・目標・エリアカード・ corruption バー・カーソル）、`console.tsx`、`title.tsx`、`pause.tsx`
- `src/game/engine.ts` — フェーズ機械（`title → room → focus → eaten → world → collapse → aftermath`）、強制カメラ、コンソール意味論、UI への差分通知、再起動
- `src/game/room.ts` — 夜の自室（GLB）、机とモニター、BSOD スクリーン（CanvasTexture + シェーダ）、帰還後の異変、天井破壊の瓦礫
- `src/game/world.ts` — 異世界の地形シェーダ、霧、Cray-1 モノリス、`WAKE_UP` の石碑、落下する床と瓦礫、崩壊演出
- `src/game/player.ts` — 一人称移動、頭の揺れ、接地、衝突の押し出し
- `src/game/input.ts` — キーボード／マウス／Pointer Lock（拒否時はドラッグへ自動フォールバック）／タッチ
- `src/game/audio.ts` — ループする環境音のベッド、ワンショット、ダッキング、ミュート
- `src/game/post.ts` + `src/game/shaders.ts` — HDR バッファ → ブルーム → ACES トーンマップ、走査線、粒状ノイズ、色収差、ワープ、フラッシュ、ピクセレーション
- `src/game/canvas.ts` — BSOD 画面・ウィンドウ・石碑などのプロシージャルテクスチャ

アセットは `public/models`（8 点の GLB）、`public/textures`、`public/audio`（41 本）に同梱。ネットワークに依存しません。

## 検証

- `npm run build`（`tsc --noEmit` + Vite）
- `node scripts/check-shaders.mjs` — 全頂点／フラグメントシェーダの組み合わせを検証
- `scripts/smoke/` — Node + 偽 DOM/WebGL でエンジンを実際に走らせる自動スモークテスト（シーン構築、`focus → eaten → world → collapse → aftermath → restart` の全フェーズ、コンソール、NaN 検査）

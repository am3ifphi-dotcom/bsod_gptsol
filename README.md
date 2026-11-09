# NOT RESPONDING（応答なし）

深夜、ブルースクリーンに喰われる。——短編ファーストパーソン・グリッチホラー。

A short first-person glitch-horror experience: your PC dies with `0x000000F4` — and something on the other side of the blue screen has noticed you.

## あらすじ / 流れ

1. **部屋** — 深夜の書斎。光るPCモニターだけが味方かと思った。
2. **調べる** — PCを調べると、ブルースクリーンが「軋む」。画面の `:(` を何度も突いてしまう。
3. **喰われる** — 画面の向こうへ引きずり込まれる。
4. **青の世界** — 回路の砂丘と漂うモノリス、サーバーラックの回廊。世界の中心には、CRAY風の巨大構造物。
5. **帰還** — 世界の中心に焼かれた一つの言葉を見つけ、ゲーム内コンソールに入力せよ。そして落ちる——元の部屋へ。

`WAKE_UP` は探索によってのみ見つかります。メニューのどこかに書いてあるわけではありません。

## 操作

| キー | 動作 |
| --- | --- |
| `W A S D` | 移動 |
| マウス | 視点 |
| `Shift` | 走る |
| `E` | 調べる / 離れる |
| `C` | ゲーム内カーネルコンソールを開閉 |
| `Esc` | ポーズ / 閉じる |
| `M` | ミュート |
| `R` | 帰還後に限り、最初からやり直す |
| `Enter` | コンソールでコマンド実行 |

画面の点滅・急な音・カメラの揺れを含みます。光過敏性発作の既往がある方は、タイトル画面またはポーズメニューの「点滅を減らす」を有効にしてください。

## セットアップ

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 本番ビルド (dist/)
npm run preview  # ビルド結果のプレビュー
```

必要環境: Node.js 20+ / モダンブラウザ（WebGL2）。

## 技術構成

- **Vite + React 19 + TypeScript**
- **three.js 0.186** — 描画はすべて命令的エンジン (`src/game/engine.ts`) が担当し、React はHUD・オーバーレイ（タイトル / ポーズ / コンソール / トースト等）のみを重ねます
- サウンドは Web Audio API で全て手続き生成（音声ファイルなし）
- テクスチャ（木目・回路パターン・ルーン環・グリフ柱・クラック等）はすべて Canvas2D で生成
- セッション再マウント方式のリプレイ（`src/App.tsx` が `session` をインクリメントして canvas を remount）。帰還後に何度でも遊び直せます
- 進行保存: `localStorage` (`bsod_settings` / `bsod_cleared`)

```
src/
  App.tsx               HUD・フェーズ管理・リスタートループ
  game/
    engine.ts           命令的3Dエンジン（部屋→BSOD→喰われる→世界→崩壊→帰還）
    room.ts             部屋シーン（GLBベッドルーム + 手続き木目チャブダイ + BSOD画面ノード）
    world.ts            致命的エラーの世界（地形 / 大規模構造物 / ラック / WAKE_UP）
    bsod.ts             ブルースクリーン自体のプロシージャル描画・腐敗・残響モード
    audio.ts            全音響の合成（心音・耳鳴り・風・回線ノイズ…）
    textures.ts         Canvas2Dテクスチャ群
  components/           TitleScreen / PauseMenu / ConsoleOverlay
```

## 3Dモデル

`public/models/*.glb` は、先行実験リポジトリ `am3ifphi-dotcom/bsod_ex`（GitHub）で作成・最適化したモデルです（bedroom / gaming_pc / crt_monitor / cray1 / server_rack / motherboard / cables / office_chair）。

Google Drive 上の `modern_stylized_bedroom.glb`（〜62 MB）を豪華版として使いたい場合は、
**Driveから直接落として** `public/models/bedroom.glb` に上書き配置してください（Drop-in。コード変更不要）。
リポジトリには容量上の理由で含めません。

## 品質設定

- `HIGH`: ピクセル比 1.75 + PCF シャドウ
- `軽量 (low)`: ピクセル比 1.0・アンチエイリアスなし・影なし（統合GPU向け）
- 「点滅を減らす」: フラッシュ・点滅演出を大幅に抑制

## ライセンス表記

ゲームコード: このリポジトリ。3Dモデル: 各所有者に帰属（`bsod_ex` で作成した自作資産）。

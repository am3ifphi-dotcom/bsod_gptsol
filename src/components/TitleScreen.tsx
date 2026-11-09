import type { Settings } from '../game/types';

interface Props {
  settings: Settings;
  cleared: boolean;
  onSettings(s: Settings): void;
  onStart(): void;
}

export function TitleScreen({ settings, cleared, onSettings, onStart }: Props) {
  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });
  return (
    <div className="title-screen">
      <div className="title-scanlines" />
      <div className="title-inner">
        <div className="title-kicker mono">FIRST-PERSON GLITCH HORROR — 短編ホラー体験</div>
        <h1 className="title-main">
          <span className="title-glitch">NOT</span><br />
          RESPONDING
        </h1>
        <p className="title-sub mincho">応答なし。——深夜、ブルースクリーンに喰われる。</p>
        {cleared && <div className="title-cleared mono">— 体験済み —</div>}

        <div className="title-actions">
          <button className="btn-start" onClick={onStart}>体験を開始する</button>
          <p className="title-warning">
            画面の点滅・急な音・カメラの揺れを含みます。<br />
            光過敏性発作の既往がある方は、下の「点滅を減らす」を有効にしてください。
          </p>
        </div>

        <div className="title-settings">
          <label className="setting-item">
            <span className="mono">VOLUME</span>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.volume}
              onChange={(e) => set({ volume: Number(e.target.value) })}
              aria-label="音量"
            />
            <span className="mono" style={{ width: 30 }}>{settings.volume}</span>
          </label>
          <div className="setting-item">
            <span className="mono">品質</span>
            <div className="toggle-group">
              <button className={`seg ${settings.quality === 'high' ? 'active' : ''}`} onClick={() => set({ quality: 'high' })}>HIGH</button>
              <button className={`seg ${settings.quality === 'low' ? 'active' : ''}`} onClick={() => set({ quality: 'low' })}>軽量</button>
            </div>
          </div>
          <button
            className={`setting-item toggle ${settings.reducedFlash ? 'on' : ''}`}
            onClick={() => set({ reducedFlash: !settings.reducedFlash })}
            aria-pressed={settings.reducedFlash}
          >
            <span className="mono" style={{ marginLeft: 8 }}>点滅を減らす</span>
          </button>
        </div>
      </div>

      <div className="title-bottom">
        <div className="title-controls mono">
          <span><b>W A S D</b>移動</span>
          <span><b>マウス</b>視点</span>
          <span><b>Shift</b>走る</span>
          <span><b>E</b>調べる / 離れる</span>
          <span><b>C</b>コンソール</span>
          <span><b>Esc</b>メニュー</span>
          <span><b>M</b>ミュート</span>
        </div>
        <div className="title-credits mono">
          使用モデル: bedroom / gaming_pc(BSOD_SCREEN_NODE) / crt_monitor<br />
          office_chair / cray1 / server_rack / motherboard / cables（リポジトリ同梱 GLB）<br />
          音響・テクスチャはすべてプロシージャル生成
        </div>
      </div>
    </div>
  );
}

import type { Settings } from '../game/types';

interface Props {
  settings: Settings;
  onSettings(s: Settings): void;
  onResume(): void;
  onRestart(): void;
  onTitle(): void;
}

export function PauseMenu({ settings, onSettings, onResume, onRestart, onTitle }: Props) {
  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });
  return (
    <div className="pause-layer" onClick={onResume}>
      <div className="pause-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="一時停止">
        <div className="pause-title mono">一時停止</div>
        <div className="pause-sub mono">PAUSED — 体験はここで待っています</div>

        <button className="pause-btn primary" onClick={onResume}>▶　体験に戻る</button>
        <button className="pause-btn" onClick={onRestart}>↻　最初からやり直す</button>
        <button className="pause-btn" onClick={onTitle}>⌂　タイトルへ戻る</button>

        <div className="pause-settings">
          <label className="row small">
            <span className="mono" style={{ width: 44 }}>音量</span>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.volume}
              onChange={(e) => set({ volume: Number(e.target.value) })}
              style={{ flex: 1, accentColor: '#37c3ef' }}
            />
            <span className="mono" style={{ width: 26 }}>{settings.volume}</span>
          </label>
          <div className="row small">
            <span className="mono" style={{ width: 44 }}>品質</span>
            <div className="toggle-group">
              <button className={`seg ${settings.quality === 'high' ? 'active' : ''}`} onClick={() => set({ quality: 'high' })}>HIGH</button>
              <button className={`seg ${settings.quality === 'low' ? 'active' : ''}`} onClick={() => set({ quality: 'low' })}>軽量</button>
            </div>
          </div>
          <div className="row small">
            <span className="mono" style={{ width: 44 }}>演出</span>
            <button
              className={`setting-item toggle ${settings.reducedFlash ? 'on' : ''}`}
              onClick={() => set({ reducedFlash: !settings.reducedFlash })}
              aria-pressed={settings.reducedFlash}
            >
              <span className="mono" style={{ marginLeft: 8 }}>点滅を減らす</span>
            </button>
          </div>
        </div>

        <div className="pause-controls mono">
          <div><b>W A S D</b>移動　<b>マウス</b>視点　<b>Shift</b>走る</div>
          <div><b>E</b>調べる / 離れる　<b>C</b>コンソール　<b>M</b>ミュート</div>
          <div><b>Esc</b>メニュー / 閉じる　<b>R</b>帰還後：やり直す</div>
        </div>
      </div>
    </div>
  );
}

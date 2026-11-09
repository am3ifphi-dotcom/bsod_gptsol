interface Props {
  open: boolean;
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onMute: () => void;
  onResume: () => void;
  onRestart: () => void;
}

export const PauseMenu = ({ open, volume, muted, onVolume, onMute, onResume, onRestart }: Props) => {
  if (!open) return null;
  return (
    <div id="pause">
      <div className="pause-card">
        <h2>PAUSED</h2>
        <div className="sub">呼吸を整えてください。</div>
        <div className="row">
          <label>音量</label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => onVolume(Number(e.target.value) / 100)}
          />
        </div>
        <div className="row">
          <label>ミュート</label>
          <button className="btn ghost" style={{ padding: "6px 14px", fontSize: 10 }} onClick={onMute}>
            {muted ? "ON" : "OFF"}
          </button>
        </div>
        <div className="actions">
          <button className="btn" onClick={onResume}>
            再開する
          </button>
          <button className="btn ghost" onClick={onRestart}>
            はじめから
          </button>
        </div>
        <div className="pause-note">Esc で戻る · 進行状況は保存されません</div>
      </div>
    </div>
  );
};

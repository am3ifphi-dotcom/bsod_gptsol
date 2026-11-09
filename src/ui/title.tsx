interface Props {
  visible: boolean;
  ready: boolean;
  onStart: () => void;
  onHowTo: () => void;
  showHowTo: boolean;
}

export const TitleScreen = ({ visible, ready, onStart, onHowTo, showHowTo }: Props) => (
  <div id="title" className={visible ? "" : "gone"} aria-hidden={!visible}>
    <div className="title-inner">
      <div className="title-eyebrow">NULL STUDIO · interactive short</div>
      <div className="title-face">:(</div>
      <h1 className="title-main">NOT RESPONDING</h1>
      <div className="title-rule" />
      <p className="title-desc">
        深夜 02:47。部屋の PC が、止まらない。
        <br />
        青い画面の向こう側へ、歩いて、触れて、帰ってくる。
      </p>
      <button className="btn" onClick={onStart} disabled={!ready}>
        {ready ? "はじめる" : "読み込み中…"}
      </button>
      <div className="title-foot">
        <span>一人称 · 約10〜15分</span>
        <span>ヘッドホン推奨</span>
        <span className="mono">WASD / MOUSE / E / C</span>
      </div>
      <div className="title-warn">
        点滅・強いノイズ・急な音・カメラの揺れを含みます。光に敏感な方、気分の悪くなりやすい方はご注意ください。
      </div>
      <button className="btn ghost" onClick={onHowTo} style={{ pointerEvents: "auto", padding: "9px 18px", fontSize: 10 }}>
        操作方法
      </button>
      {showHowTo && (
        <div className="title-warn jp" style={{ color: "rgba(200,220,240,0.8)", textAlign: "left", maxWidth: 420 }}>
          WASD / 矢印 … 移動　　SHIFT … 走る
          <br />
          マウス … 視点（ドラッグでも可）　　E … 調べる
          <br />
          C … コンソール（異世界のみ）　　ESC … ポーズ
          <br />
          M … ミュート　　※クリックでポインタを固定します
        </div>
      )}
    </div>
  </div>
);

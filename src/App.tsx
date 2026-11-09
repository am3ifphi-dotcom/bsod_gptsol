import { useCallback, useEffect, useRef, useState } from "react";
import { loadAssets, type Assets } from "./game/assets";
import { Engine, type LogLine, type UIState } from "./game/engine";
import { AreaCard, CorruptionBar, Crosshair, Cursor, Hint, Objective, Prompt, Subtitles } from "./ui/hud";
import { ConsoleOverlay } from "./ui/console";
import { TitleScreen } from "./ui/title";
import { PauseMenu } from "./ui/pause";

const INITIAL_UI: UIState = {
  phase: "boot",
  prompt: null,
  subtitle: null,
  objective: null,
  hint: null,
  corruption: 0,
  consoleOpen: false,
  cursor: false,
  cursorHot: false,
  busy: false,
  locked: false,
  dragHint: false,
  areaCard: null,
  ended: false,
  found: false,
  paused: false,
};

const readSetting = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeSetting = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [ui, setUI] = useState<UIState>(INITIAL_UI);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  const [boot, setBoot] = useState({ progress: 0, label: "初期化", done: false });
  const [error, setError] = useState<string | null>(null);
  const [titleGone, setTitleGone] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const [volume, setVolume] = useState(() => Number(readSetting("nr.volume", "0.8")));
  const [muted, setMuted] = useState(() => readSetting("nr.muted", "0") === "1");
  const [touch, setTouch] = useState(false);

  /* ---------------- boot ---------------- */
  useEffect(() => {
    let cancelled = false;
    const lineId = { v: 0 };
    const audioCtx = new AudioContext();
    writeSetting("nr.boot", "1");

    (async () => {
      try {
        setBoot({ progress: 0.02, label: "FONT", done: false });
        await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2200))]);
        let assets: Assets | null = null;
        assets = await loadAssets(audioCtx, ({ label, progress }) => {
          if (!cancelled) setBoot({ progress: 0.05 + progress * 0.85, label: label.toUpperCase(), done: false });
        });
        if (cancelled || !assets) return;
        setBoot({ progress: 0.94, label: "COMPILING SHADERS", done: false });
        await new Promise((r) => setTimeout(r, 120));

        const canvas = canvasRef.current;
        if (!canvas) throw new Error("canvas missing");
        const engine = new Engine(canvas, assets, audioCtx, {
          onUI: (patch) => setUI((prev) => ({ ...prev, ...patch })),
          onLine: (l) => {
            lineId.v += 1;
            setLines((prev) => {
              const next = [...prev, { ...l, id: lineId.v }];
              return next.length > 220 ? next.slice(next.length - 220) : next;
            });
          },
          onClearConsole: () => setLines([]),
        });
        engineRef.current = engine;
        await engine.init();
        engine.setVolume(volume);
        engine.setMuted(muted);
        if (cancelled) return;
        setReady(true);
        setBoot({ progress: 1, label: "READY", done: true });
      } catch (err) {
        console.error(err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
      void audioCtx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- settings ---------------- */
  useEffect(() => {
    engineRef.current?.setVolume(volume);
    writeSetting("nr.volume", String(volume));
  }, [volume]);
  useEffect(() => {
    engineRef.current?.setMuted(muted);
    writeSetting("nr.muted", muted ? "1" : "0");
  }, [muted]);

  useEffect(() => {
    setTouch(window.matchMedia("(hover: none) and (pointer: coarse)").matches);
  }, []);

  const paused = ui.paused;

  const start = () => {
    const e = engineRef.current;
    if (!e) return;
    setTitleGone(true);
    e.setVolume(volume);
    e.setMuted(muted);
    e.start();
    window.setTimeout(() => {
      if (e.pointerLocked === false) setUI((p) => ({ ...p, dragHint: true }));
    }, 900);
    window.setTimeout(() => setUI((p) => ({ ...p, dragHint: false })), 7000);
  };

  const submit = (v: string) => {
    const e = engineRef.current;
    if (!e) return;
    e.submitCommand(v);
    setValue("");
  };

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  /* ---------------- touch controls ---------------- */
  const stickRef = useRef<HTMLDivElement>(null);
  const stickPointer = useRef<number | null>(null);
  const onStick = (e: React.PointerEvent) => {
    const el = stickRef.current;
    const eng = engineRef.current;
    if (!el || !eng) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width / 2)));
    const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / (r.height / 2)));
    eng.setTouchAxis(dx, -dy);
    const knob = el.firstElementChild as HTMLElement | null;
    if (knob) knob.style.transform = `translate(${dx * 32}px, ${dy * 32}px)`;
  };
  const endStick = () => {
    engineRef.current?.setTouchAxis(0, 0);
    const knob = stickRef.current?.firstElementChild as HTMLElement | null;
    if (knob) knob.style.transform = "translate(0px, 0px)";
    stickPointer.current = null;
  };

  if (error) {
    return (
      <div id="error">
        <div className="box">
          <h2>RENDERER UNAVAILABLE</h2>
          <p>
            WebGL2 を初期化できませんでした。
            <br />
            ハードウェアアクセラレーションを有効にした Chrome / Edge / Firefox / Safari の最新版でお試しください。
          </p>
          <code>{error}</code>
        </div>
      </div>
    );
  }

  const playing = ui.phase !== "boot" && ui.phase !== "title";
  const showHud = playing && !ui.consoleOpen;

  return (
    <>
      <div id="stage">
        <canvas ref={canvasRef} style={{ cursor: ui.cursor ? "none" : "default" }} />

        {playing && !paused && (
          <div className="layer" id="hud">
            <Crosshair show={!ui.cursor && !ui.busy} hot={false} />
            <Prompt prompt={showHud ? ui.prompt : null} />
            <Objective text={ui.objective} />
            <Hint text={ui.hint} />
            <Subtitles subtitle={ui.subtitle} />
            <AreaCard card={ui.areaCard} />
            <CorruptionBar value={ui.corruption} show={ui.phase === "focus" || ui.corruption > 0.01} />
            <div id="fin" className={ui.ended && !ui.consoleOpen ? "show" : ""}>
              <span className="jp">了</span>
              <span className="en">END OF TRANSMISSION</span>
              <span className="hint">E モニター / R もう一度 / Esc メニュー</span>
            </div>
            <Cursor show={ui.cursor} hot={ui.cursorHot} />
            <div id="drag-hint" className={ui.dragHint ? "show" : ""}>
              マウスをドラッグして視点を動かせます
              <br />
              クリックで操作を再開
            </div>
          </div>
        )}

        <ConsoleOverlay
          open={ui.consoleOpen}
          lines={lines}
          value={value}
          onChange={setValue}
          onSubmit={submit}
          found={ui.found}
        />

        <PauseMenu
          open={paused}
          volume={volume}
          muted={muted}
          onVolume={setVolume}
          onMute={toggleMute}
          onResume={() => engineRef.current?.setPaused(false)}
          onRestart={() => {
            engineRef.current?.setPaused(false);
            engineRef.current?.restart();
            setValue("");
          }}
        />

        {touch && playing && (
          <div id="touch" className={paused || ui.consoleOpen ? "" : "on"}>
            <div
              className="stick"
              ref={stickRef}
              onPointerDown={(e) => {
                stickPointer.current = e.pointerId;
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                onStick(e);
              }}
              onPointerMove={(e) => {
                if (stickPointer.current === e.pointerId) onStick(e);
              }}
              onPointerUp={endStick}
              onPointerCancel={endStick}
            >
              <i />
            </div>
            <div className="act">
              <button onClick={() => engineRef.current?.toggleConsole()}>CONS</button>
              <button onClick={() => engineRef.current?.touchInteract()}>E</button>
            </div>
          </div>
        )}

        <TitleScreen
          visible={!titleGone}
          ready={ready}
          onStart={start}
          onHowTo={() => setShowHowTo((v) => !v)}
          showHowTo={showHowTo}
        />

        <div id="boot" className={boot.done ? "gone" : ""}>
          <div className="glyph">:(</div>
          <div className="bar">
            <i style={{ width: `${Math.round(boot.progress * 100)}%` }} />
          </div>
          <div className="meta">
            <span>{boot.label}</span>
            <span>{Math.round(boot.progress * 100)}%</span>
          </div>
        </div>
      </div>
    </>
  );
}

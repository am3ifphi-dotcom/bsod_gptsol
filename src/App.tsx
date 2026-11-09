import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Engine } from './game/engine';
import type { EngineEvents, Phase, Settings } from './game/types';
import { TitleScreen } from './components/TitleScreen';
import { ConsoleOverlay } from './components/ConsoleOverlay';
import { PauseMenu } from './components/PauseMenu';

const DEFAULT_SETTINGS: Settings = { volume: 70, quality: 'high', reducedFlash: false };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('bsod_settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* noop */ }
  return { ...DEFAULT_SETTINGS };
}

export default function App() {
  const [session, setSession] = useState(0);
  const [phase, setPhase] = useState<Phase>('boot');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [objective, setObjective] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [corruption, setCorruption] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [cleared, setCleared] = useState(() => {
    try { return localStorage.getItem('bsod_cleared') === '1'; } catch { return false; }
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((text: string, ms = 3400) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text });
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  const events = useMemo<EngineEvents>(() => ({
    onPhase: (p) => setPhase(p),
    onPrompt: (p) => setPrompt(p),
    onToast: (text, ms) => showToast(text, ms),
    onSubtitle: (s) => setSubtitle(s),
    onConsoleOpen: (open) => setConsoleOpen(open),
    onPauseRequest: () => setPauseOpen((v) => !v),
    onObjective: (o) => setObjective(o),
    onCorruption: (level) => setCorruption(level),
    onWakeDiscovered: () => { /* toast already emitted by engine */ },
    onRequestRestart: () => restart(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [showToast]);

  /* engine lifecycle — rebuilt per session for a bulletproof restart */
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine(canvasRef.current, events, settings);
    engineRef.current = engine;
    (window as unknown as { __engine: Engine }).__engine = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, events]);

  /* settings → engine + persistence */
  useEffect(() => {
    try { localStorage.setItem('bsod_settings', JSON.stringify(settings)); } catch { /* noop */ }
    engineRef.current?.setSettings(settings);
  }, [settings]);

  /* pause → freeze engine input */
  useEffect(() => {
    engineRef.current?.setPaused(pauseOpen);
  }, [pauseOpen]);

  const restart = useCallback(() => {
    setSession((s) => s + 1);
    setPhase('boot');
    setPrompt(null);
    setObjective(null);
    setSubtitle(null);
    setToast(null);
    setConsoleOpen(false);
    setPauseOpen(false);
    setCorruption(0);
  }, []);

  const goTitle = useCallback(() => {
    restart();
  }, [restart]);

  const startGame = useCallback(() => {
    engineRef.current?.startGame();
  }, []);

  /* the ending is reached → remember it */
  useEffect(() => {
    if (phase === 'returned') setCleared(true);
  }, [phase]);

  const inGame = phase !== 'title' && phase !== 'boot';
  const walking = phase === 'room' || phase === 'world' || phase === 'returned';
  const exploring = phase === 'devoured' || phase === 'collapse';

  return (
    <div className="game-root">
      <div className="game-canvas-wrap">
        <canvas key={session} ref={canvasRef} aria-label="NOT RESPONDING ゲーム画面" />
      </div>

      {/* ---------- HUD ---------- */}
      {inGame && !consoleOpen && (
        <div className="hud">
          {objective && !exploring && <div className="hud-objective mono">{objective}</div>}
          {walking && <div className="crosshair" />}
          <div className="hud-build mono">NOT RESPONDING — 0x000000F4</div>
          {prompt && !exploring && <div className="prompt mono">{prompt}</div>}
          {toast && <div key={toast.id} className="toast mono">{toast.text}</div>}
          {subtitle && <div className="subtitle mincho">{subtitle}</div>}
          {phase === 'examine' && (
            <div className="corruption">
              <div className="corruption-label mono">ひずみ</div>
              <div className="corruption-pips">
                {Array.from({ length: 8 }, (_, i) => {
                  const on = i < corruption;
                  const cls = !on ? 'pip' : corruption >= 7 ? 'pip on doom' : corruption >= 5 ? 'pip on hot' : 'pip on';
                  return <div key={i} className={cls} />;
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {/* subtitles show even while the console is up (collapse closes it anyway) */}
      {exploring && subtitle && (
        <div className="hud"><div className="subtitle mincho">{subtitle}</div></div>
      )}

      {/* ---------- title / boot ---------- */}
      {phase === 'boot' && (
        <div className="boot-screen">
          <div className="boot-glyph mono">:(</div>
          <div className="boot-bar"><div className="boot-bar-inner" /></div>
          <div className="boot-text mono">部屋と、その向こうを展開中</div>
        </div>
      )}
      {phase === 'title' && (
        <TitleScreen
          settings={settings}
          cleared={cleared}
          onSettings={setSettings}
          onStart={startGame}
        />
      )}

      {/* ---------- console ---------- */}
      {consoleOpen && (
        <ConsoleOverlay
          onClose={() => engineRef.current?.closeConsole()}
          execute={(cmd) => engineRef.current?.executeConsole(cmd) ?? []}
        />
      )}

      {/* ---------- pause ---------- */}
      {pauseOpen && !consoleOpen && inGame && (
        <PauseMenu
          settings={settings}
          onSettings={setSettings}
          onResume={() => setPauseOpen(false)}
          onRestart={restart}
          onTitle={goTitle}
        />
      )}
    </div>
  );
}

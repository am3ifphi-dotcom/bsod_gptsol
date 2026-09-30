import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronRight,
  Headphones, Maximize, Minimize, Mouse, Pause, Play, RotateCcw, Settings2,
  Terminal, Volume2, VolumeX, X,
} from 'lucide-react';
import GameCanvas from './components/GameCanvas';
import type { GameEngine } from './game/Engine';
import { initialSnapshot, isCinematic, isPlayable, type GamePreferences, type GameSnapshot } from './game/types';

type Modal = 'about' | 'controls' | 'settings' | null;
const ease = [0.22, 1, 0.36, 1] as const;

function getPreferences(): GamePreferences {
  const defaults: GamePreferences = {
    volume: 0.45,
    muted: false,
    gentle: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    quality: window.matchMedia('(pointer: coarse)').matches ? 'low' : 'high',
  };
  try {
    const saved = JSON.parse(localStorage.getItem('null-preferences') || '{}');
    return {
      volume: typeof saved.volume === 'number' ? Math.max(0, Math.min(1, saved.volume)) : defaults.volume,
      muted: typeof saved.muted === 'boolean' ? saved.muted : defaults.muted,
      gentle: typeof saved.gentle === 'boolean' ? saved.gentle : defaults.gentle,
      quality: saved.quality === 'low' ? 'low' : saved.quality === 'high' ? 'high' : defaults.quality,
    };
  } catch {
    return defaults;
  }
}

function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button className="brand" onClick={onClick} aria-label="NULL STUDIO - タイトルへ">
      <svg className="brand-mark" width="31" height="32" viewBox="0 0 31 32" fill="none" aria-hidden="true">
        <path d="M3 25V7h7.5L21 25h7V7" stroke="currentColor" strokeWidth="2.2" />
        <path d="M10 25V7M21 25V7" stroke="currentColor" strokeWidth="1.1" opacity=".5" />
        <path d="M3 31H28M3 1H28" stroke="currentColor" strokeWidth=".7" opacity=".3" />
      </svg>
      <span className="brand-type">NULL<span className="brand-sub">INTERACTIVE STUDIO</span></span>
    </button>
  );
}

function Dialog({ children, onClose, className = '', label }: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('button, input, select')?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previous?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <motion.div
      className="dialog-backdrop"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.section
        ref={ref} role="dialog" aria-modal="true" aria-label={label}
        className={`dialog ${className}`}
        initial={{ opacity: 0, y: reduced ? 0 : 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.32, ease }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
          if (event.key === 'Tab') {
            const focusable = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [tabindex="0"]');
            if (!focusable?.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}
      >
        <button className="dialog-close icon-button" onClick={onClose} aria-label="閉じる"><X size={19} strokeWidth={1.5} /></button>
        {children}
      </motion.section>
    </motion.div>
  );
}

function PreferenceControls({ preferences, onChange, fullscreen, onFullscreen }: {
  preferences: GamePreferences;
  onChange: (preferences: GamePreferences) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
}) {
  return (
    <div className="preference-controls">
      <div className="setting-volume">
        <div className="setting-label"><span>マスター音量</span><span className="mono">{preferences.muted ? 'MUTED' : `${Math.round(preferences.volume * 100)}%`}</span></div>
        <div className="volume-row">
          <button className="icon-button" onClick={() => onChange({ ...preferences, muted: !preferences.muted })} aria-label={preferences.muted ? 'ミュートを解除' : 'ミュート'}>
            {preferences.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <input type="range" min="0" max="1" step="0.01" value={preferences.volume} aria-label="マスター音量" onChange={(event) => onChange({ ...preferences, volume: Number(event.target.value), muted: false })} />
        </div>
      </div>
      <label className="setting-row switch-row">
        <span><span className="setting-name">演出を穏やかに</span><span className="setting-description">画面の乱れ・頭の揺れを抑える</span></span>
        <input type="checkbox" checked={preferences.gentle} onChange={(event) => onChange({ ...preferences, gentle: event.target.checked })} />
        <span className={`square-toggle ${preferences.gentle ? 'checked' : ''}`} aria-hidden="true">{preferences.gentle && <Check size={13} />}</span>
      </label>
      <label className="setting-row">
        <span className="setting-name">描画品質</span>
        <select value={preferences.quality} onChange={(event) => onChange({ ...preferences, quality: event.target.value as 'high' | 'low' })} aria-label="描画品質">
          <option value="high">高品質</option><option value="low">軽量</option>
        </select>
      </label>
      <button className="setting-row fullscreen-setting" onClick={onFullscreen}>
        <span className="setting-name">{fullscreen ? '全画面を終了' : '全画面でプレイ'}</span>
        {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
      </button>
    </div>
  );
}

const controlRows = [
  { keys: ['W', 'A', 'S', 'D'], label: '部屋と異世界を歩く', detail: 'Shift で速く移動' },
  { keys: ['MOUSE'], label: '視点を動かす', detail: 'ドラッグ操作にも対応' },
  { keys: ['E'], label: 'PCを調べる / 画面から離れる' },
  { keys: ['CLICK / HOLD'], label: 'モニターの顔に触れる', detail: 'Space キーでも操作可能' },
  { keys: ['C'], label: 'ゲーム内コンソールを開く', detail: '異世界で使用可能 / Enter で実行' },
  { keys: ['ESC'], label: '一時停止 / コンソールを閉じる' },
];

function Console({ engine, discovered }: { engine: GameEngine | null; discovered: boolean }) {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<{ text: string; type: 'system' | 'input' | 'error' }[]>([
    { text: 'NULL RECOVERY SHELL [Version 0.0.0317]', type: 'system' },
    { text: '現実との接続は失われています。', type: 'system' },
    { text: 'HELP で利用可能な操作を表示。', type: 'system' },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(0);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => { cancelAnimationFrame(frame); inputRef.current?.blur(); };
  }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [lines]);

  const submit = () => {
    if (!input.trim()) return;
    const command = input.slice(0, 100);
    history.current.push(command);
    historyIndex.current = history.current.length;
    const result = engine?.executeCommand(command);
    if (result?.clear) setLines([]);
    else setLines((old) => [
      ...old,
      { text: `visitor@unknown:~$ ${command}`, type: 'input' as const },
      ...(result?.lines || []).map((text) => ({ text, type: result?.error ? 'error' as const : 'system' as const })),
    ].slice(-80));
    setInput('');
  };

  return (
    <motion.div className="console-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section
        className="game-console" ref={ref} role="dialog" aria-modal="true" aria-label="ゲーム内コンソール"
        initial={{ y: 25, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 15, opacity: 0 }} transition={{ duration: 0.25, ease }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); engine?.closeConsole(); }
          if (event.key === 'Tab') {
            const controls = ref.current?.querySelectorAll<HTMLElement>('button, input');
            if (!controls?.length) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}
      >
        <div className="console-heading"><span><span className="terminal-led" /><Terminal size={14} /> RECOVERY TERMINAL</span><button className="icon-button" onClick={() => engine?.closeConsole()} aria-label="コンソールを閉じる"><X size={17} /></button></div>
        <div className="console-log" ref={logRef} role="log" aria-live="polite">
          {lines.map((line, index) => <div key={index} className={`console-line ${line.type}`}>{line.text}</div>)}
        </div>
        <form className="console-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label htmlFor="command-input" className="console-prompt">visitor@unknown:~$</label>
          <input
            id="command-input" ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)}
            placeholder="コマンドを入力..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} maxLength={100}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                historyIndex.current = Math.max(0, Math.min(history.current.length, historyIndex.current + (event.key === 'ArrowUp' ? -1 : 1)));
                setInput(history.current[historyIndex.current] || '');
              }
            }}
          />
          <button className="console-enter" type="submit" aria-label="コマンドを実行">ENTER <ArrowRight size={14} /></button>
        </form>
        <div className="console-footer"><span>{discovered ? 'MEMORY SIGNATURE DETECTED' : 'SEARCHING FOR A MEMORY...'}</span><span><kbd>Esc</kbd> 閉じる</span></div>
      </motion.section>
    </motion.div>
  );
}

function TouchControls({ engine, state }: { engine: GameEngine | null; state: GameSnapshot }) {
  const directions = [
    { key: 'KeyW', icon: ArrowUp, className: 'up' },
    { key: 'KeyA', icon: ArrowLeft, className: 'left' },
    { key: 'KeyS', icon: ArrowDown, className: 'down' },
    { key: 'KeyD', icon: ArrowRight, className: 'right' },
  ];
  return (
    <div className="touch-controls">
      <div className="touch-pad">
        {directions.map(({ key, icon: Icon, className }) => (
          <button key={key} className={className} aria-label={`${className}方向へ移動`}
            onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); engine?.setKey(key, true); }}
            onPointerUp={() => engine?.setKey(key, false)} onLostPointerCapture={() => engine?.setKey(key, false)}>
            <Icon size={21} strokeWidth={1.4} />
          </button>
        ))}
      </div>
      <div className="touch-actions">
        {state.nearPC && <button onClick={() => engine?.interact()}><span>E</span> 調べる</button>}
        {state.phase === 'world' && <button onClick={() => engine?.openConsole()}><Terminal size={18} /> コンソール</button>}
      </div>
    </div>
  );
}

export default function App() {
  const engine = useRef<GameEngine | null>(null);
  const [state, setState] = useState<GameSnapshot>({ ...initialSnapshot });
  const [ready, setReady] = useState(false);
  const [preferences, setPreferences] = useState<GamePreferences>(getPreferences);
  const [modal, setModal] = useState<Modal>(null);
  const [soundOpen, setSoundOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState('');
  const [returnCaption, setReturnCaption] = useState(false);
  const soundRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const touch = useRef(window.matchMedia('(pointer: coarse)').matches).current;
  const title = state.phase === 'title';
  const cinematic = isCinematic(state.phase);
  const interactive = isPlayable(state.phase);

  const onReady = useCallback((value: GameEngine | null) => { engine.current = value; setReady(!!value); }, []);
  const onUpdate = useCallback((value: GameSnapshot) => setState(value), []);
  const onError = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    try { localStorage.setItem('null-preferences', JSON.stringify(preferences)); } catch { /* Preferences still work when browser storage is unavailable. */ }
  }, [preferences]);

  useEffect(() => {
    const change = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === 'KeyM' && !event.repeat) setPreferences((old) => ({ ...old, muted: !old.muted }));
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    if (!soundOpen) return;
    const close = (event: PointerEvent) => { if (!soundRef.current?.contains(event.target as Node)) setSoundOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [soundOpen]);

  useEffect(() => {
    if (state.phase !== 'returned') { setReturnCaption(false); return; }
    setReturnCaption(true);
    const timer = window.setTimeout(() => setReturnCaption(false), 13000);
    return () => window.clearTimeout(timer);
  }, [state.phase]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setNotice('このブラウザでは全画面表示をご利用いただけません。');
    } catch { setNotice('全画面にできませんでした。ブラウザの表示設定をご利用ください。'); }
  };

  const openModal = (type: Exclude<Modal, null>) => {
    setSoundOpen(false);
    if (!title) { engine.current?.closeConsole(); engine.current?.pause(); }
    setModal(type);
  };

  const begin = () => {
    setModal(null);
    setSoundOpen(false);
    if (title) engine.current?.start();
    else engine.current?.resume();
  };

  const goToTitle = () => {
    setModal(null);
    setSoundOpen(false);
    engine.current?.toTitle();
  };

  const restart = () => { setModal(null); setSoundOpen(false); engine.current?.restart(); };

  const chapter = state.phase === 'world' || state.phase === 'collapse' ? '02' : state.phase === 'returned' ? '03' : '01';
  const chapterName = chapter === '02' ? 'THE OTHER SIDE' : chapter === '03' ? 'YOUR ROOM, AGAIN' : 'YOUR ROOM';

  return (
    <main className={`experience ${title ? 'is-title' : 'in-game'} ${cinematic ? 'is-cinematic' : ''}`}>
      <GameCanvas key={reloadKey} preferences={preferences} onReady={onReady} onUpdate={onUpdate} onError={onError} />
      <div className={`scene-shade ${title ? 'title-shade' : ''}`} aria-hidden="true" />
      <div className="film-grain" aria-hidden="true" />
      <div className="screen-frame" aria-hidden="true" />

      <header className="site-header">
        <Brand onClick={goToTitle} />
        <nav className="header-nav" aria-label="メインナビゲーション">
          {title ? <>
            <button onClick={() => openModal('about')}>作品について</button>
            <span className="nav-divider" />
            <button onClick={() => openModal('controls')}>操作方法</button>
          </> : <span className="chapter"><span className="chapter-number">{chapter}</span><span className="chapter-line" />{chapterName}</span>}
        </nav>
        <div className="header-actions">
          {state.phase === 'returned' && <button className="replay-link" onClick={restart}><RotateCcw size={13} /> もう一度</button>}
          <div className="sound-control" ref={soundRef}>
            <button className={`sound-button ${preferences.muted ? 'muted' : ''}`} onClick={() => setSoundOpen(!soundOpen)} aria-expanded={soundOpen} aria-label="音声設定を開く">
              {preferences.muted || preferences.volume === 0 ? <VolumeX size={16} strokeWidth={1.5} /> : <Volume2 size={16} strokeWidth={1.5} />}
              <span>SOUND {preferences.muted || preferences.volume === 0 ? 'OFF' : 'ON'}</span>
              <span className="sound-bars" aria-hidden="true"><i /><i /><i /><i /></span>
            </button>
            <AnimatePresence>
              {soundOpen && <motion.div className="sound-popover" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSoundOpen(false); } }}>
                <div className="sound-popover-title"><span>音量</span><span>{Math.round(preferences.volume * 100)}%</span></div>
                <input type="range" min="0" max="1" step="0.01" value={preferences.volume} aria-label="音量" onChange={(event) => setPreferences({ ...preferences, volume: Number(event.target.value), muted: false })} />
                <button onClick={() => setPreferences({ ...preferences, muted: !preferences.muted })}>{preferences.muted ? <Volume2 size={13} /> : <VolumeX size={13} />}{preferences.muted ? 'ミュートを解除' : 'ミュート'}<kbd>M</kbd></button>
              </motion.div>}
            </AnimatePresence>
          </div>
          <span className="actions-divider" />
          <button className="menu-button icon-button" onClick={() => title ? openModal('settings') : engine.current?.pause()} aria-label={title ? '設定' : '一時停止メニュー'}>
            {title ? <Settings2 size={18} strokeWidth={1.4} /> : <Pause size={17} strokeWidth={1.4} />}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {title && !error && <motion.section className="hero" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: reduced ? 0 : -15 }} transition={{ duration: 0.65 }}>
          <motion.div className="hero-eyebrow" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.8 }}><span /> A SHORT HORROR EXPERIENCE</motion.div>
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.23, duration: 1, ease }}><span>NOT</span><span className="title-second" data-text="RESPONDING">RESPONDING<span className="title-period">.</span></span></motion.h1>
          <motion.div className="hero-description" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.9, ease }}>
            <h2>そのエラーは、あなたを見ている。</h2>
            <p>画面の向こうへ。戻れるとは限らない。</p>
          </motion.div>
          <motion.div className="hero-interaction" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.9, ease }}>
            <div className="hero-cta-group">
              <button className="primary-button start-button" onClick={begin} disabled={!ready}>
                <span>{ready ? '体験をはじめる' : '空間に接続中...'}</span><ArrowUpRight size={22} strokeWidth={1.5} />
              </button>
              <button className="text-button controls-link" onClick={() => openModal('controls')}>操作方法 <ArrowRight size={15} strokeWidth={1.2} /></button>
            </div>
            <div className="headphone-note"><Headphones size={13} strokeWidth={1.4} /><span>ヘッドホン推奨</span><span className="note-dot" /><span>音・空間の歪みを含みます</span></div>
          </motion.div>
        </motion.section>}
      </AnimatePresence>

      <AnimatePresence>
        {cinematic && !state.paused && <motion.div className="cinematic-bars" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} aria-hidden="true"><div /><div /></motion.div>}
      </AnimatePresence>

      {!title && !state.paused && !state.consoleOpen && <div className="game-hud">
        {interactive && <div className={`crosshair ${state.nearPC ? 'active' : ''}`} aria-hidden="true" />}
        <AnimatePresence mode="wait">
          {state.message && <motion.p key={state.message} className="story-message" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} aria-live="polite">{state.message}</motion.p>}
        </AnimatePresence>
        <AnimatePresence>
          {state.nearPC && interactive && !touch && <motion.button className="interaction-prompt" onClick={() => engine.current?.interact()} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><kbd>E</kbd><span>PCを調べる</span><ChevronRight size={14} /></motion.button>}
          {state.phase === 'focus' && <motion.div className="monitor-prompt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p>{state.progress > 0.6 ? 'まだ、離せる。' : state.progress > 0 ? '画面の奥から、何かが近づいてくる。' : 'その顔に、触れて。'}</p>
            <span>「:(」をクリック / 長押し</span>
            <div className="corruption-track"><div style={{ width: `${state.progress * 100}%` }} /></div>
            <button onClick={() => engine.current?.interact()}><kbd>E</kbd> 画面から離れる</button>
          </motion.div>}
          {state.phase === 'world' && !touch && <motion.button className="console-hint" onClick={() => engine.current?.openConsole()} initial={{ opacity: 0 }} animate={{ opacity: 0.7 }} exit={{ opacity: 0 }}><kbd>C</kbd> コンソール</motion.button>}
          {interactive && !state.pointerLocked && !touch && <motion.button className="pointer-hint" onClick={() => engine.current?.requestPointer()} initial={{ opacity: 0 }} animate={{ opacity: 0.65 }} exit={{ opacity: 0 }}><Mouse size={13} /> クリックで視点操作 <span>/ ドラッグでも操作可</span></motion.button>}
        </AnimatePresence>
        {touch && interactive && <TouchControls engine={engine.current} state={state} />}
        <AnimatePresence>
          {returnCaption && <motion.div className="return-caption" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 1.5 }}><span className="eyebrow">SESSION RESTORED / 03:18</span><h2>おかえり。</h2><p>部屋は同じだ。何かが、違う。</p></motion.div>}
        </AnimatePresence>
      </div>}

      <footer className="site-footer">
        {title ? <span className="footer-signature"><span className="footer-square" /> NULL STUDIO <span className="footer-slash">/</span> EXPERIMENT 001</span> : <div className="game-controls-footer">{interactive && !touch && <><span><kbd>W A S D</kbd> 移動</span><span><kbd>MOUSE</kbd> 視点</span><span><kbd>ESC</kbd> 一時停止</span></>}</div>}
        <button className="fullscreen-button" onClick={toggleFullscreen} aria-label={fullscreen ? '全画面を終了' : '全画面で表示'}>{fullscreen ? <Minimize size={13} strokeWidth={1.4} /> : <Maximize size={13} strokeWidth={1.4} />}<span>{fullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}</span></button>
      </footer>

      <AnimatePresence>
        {state.consoleOpen && <Console engine={engine.current} discovered={state.discovered} />}
        {state.paused && !modal && !state.consoleOpen && !error && <Dialog label="一時停止" onClose={() => engine.current?.resume()} className="pause-dialog">
          <div className="dialog-kicker"><span className="small-led" /> CONNECTION PAUSED</div>
          <h2 className="dialog-title">少し、息をして。</h2>
          <p className="dialog-intro">この部屋は、あなたを待っています。</p>
          <button className="primary-button resume-button" onClick={() => engine.current?.resume()}><span><Play size={14} fill="currentColor" /> プレイを続ける</span><ArrowRight size={18} /></button>
          <button className="menu-list-button" onClick={() => openModal('controls')}>操作方法<ArrowUpRight size={16} /></button>
          <PreferenceControls preferences={preferences} onChange={setPreferences} fullscreen={fullscreen} onFullscreen={toggleFullscreen} />
          <div className="pause-bottom"><button onClick={restart}><RotateCcw size={13} /> 最初から</button><button onClick={goToTitle}>タイトルへ <ArrowUpRight size={13} /></button></div>
        </Dialog>}
        {modal && <Dialog label={modal === 'about' ? '作品について' : modal === 'controls' ? '操作方法' : '設定'} onClose={() => setModal(null)} className={modal === 'controls' ? 'controls-dialog' : ''}>
          {modal === 'about' && <>
            <div className="dialog-kicker">NULL STUDIO / EXPERIMENT 001</div>
            <h2 className="about-title">NOT<br />RESPONDING<span>.</span></h2>
            <p className="about-headline">部屋と、青い画面と、帰り道。</p>
            <p className="dialog-body">いつもと同じ深夜。応答をやめたPC。<br />画面の中の小さな顔が、こちらを見ている。</p>
            <p className="dialog-body">歩く。触れる。見つける。<br />あなたの操作で進む、短編一人称ホラー体験。</p>
            <div className="about-details"><span>REAL-TIME 3D</span><span>HEADPHONES RECOMMENDED</span></div>
            <button className="primary-button" onClick={begin} disabled={!ready}><span>{title ? '体験をはじめる' : 'プレイに戻る'}</span><ArrowUpRight size={19} /></button>
          </>}
          {modal === 'controls' && <>
            <div className="dialog-kicker">BEFORE YOU CROSS OVER</div>
            <h2 className="dialog-title">あなたの手で、進む。</h2>
            <p className="dialog-intro">画面を眺めるだけでは、物語は動かない。</p>
            <div className="controls-table">
              {controlRows.map((row) => <div className="control-row" key={row.label}><div className="control-keys">{row.keys.map((key) => <kbd key={key}>{key}</kbd>)}</div><div><span>{row.label}</span>{row.detail && <small>{row.detail}</small>}</div></div>)}
            </div>
            <p className="controls-note">{touch ? 'タッチ操作: 画面をドラッグして視点操作。左下の矢印で移動できます。' : 'コンソール入力中は移動・視点操作が停止します。ブラウザの開発者ツールは使いません。'}</p>
            <button className="primary-button" onClick={begin} disabled={!ready}><span>{title ? '体験をはじめる' : 'プレイに戻る'}</span><ArrowRight size={19} /></button>
          </>}
          {modal === 'settings' && <>
            <div className="dialog-kicker">MAKE YOURSELF COMFORTABLE</div>
            <h2 className="dialog-title">体験を、ととのえる。</h2>
            <p className="dialog-intro">音と映像を、あなたに合わせて。</p>
            <PreferenceControls preferences={preferences} onChange={setPreferences} fullscreen={fullscreen} onFullscreen={toggleFullscreen} />
            <p className="content-warning">空間の歪み、落下、低音、短いグリッチ表現を含みます。苦手な方は「演出を穏やかに」を有効にしてください。</p>
            <button className="primary-button" onClick={() => setModal(null)}><span>設定を完了</span><Check size={17} /></button>
          </>}
        </Dialog>}
        {error && <Dialog label="接続エラー" onClose={() => { setError(''); setReloadKey((old) => old + 1); }}>
          <div className="dialog-kicker">CONNECTION LOST</div><h2 className="dialog-title">空間に、接続できない。</h2><p className="dialog-body">{error}</p>
          <button className="primary-button" onClick={() => { setError(''); setReady(false); setState({ ...initialSnapshot }); setReloadKey((old) => old + 1); }}><span>再接続する</span><RotateCcw size={16} /></button>
        </Dialog>}
        {notice && <motion.div className="notice" role="status" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{notice}</motion.div>}
      </AnimatePresence>
    </main>
  );
}

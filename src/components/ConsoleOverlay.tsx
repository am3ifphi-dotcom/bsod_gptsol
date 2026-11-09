import { useEffect, useRef, useState } from 'react';
import type { ConsoleLine } from '../game/types';

interface Props {
  onClose(): void;
  execute(cmd: string): ConsoleLine[];
}

const WELCOME: ConsoleLine[] = [
  { text: 'KERNEL 回復コンソール (0x000000F4)', kind: 'sys' },
  { text: '物理メモリは応答しません。しかし、あなたの入力はここに届きます。', kind: 'dim' },
  { text: 'コマンドを入力してください。HELP で一覧を表示。', kind: 'out' },
];

export function ConsoleOverlay({ onClose, execute }: Props) {
  const [lines, setLines] = useState<ConsoleLine[]>(WELCOME);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const submit = () => {
    const cmd = input.trim();
    setInput('');
    setHistoryIdx(-1);
    if (!cmd) return;
    setHistory((h) => [cmd, ...h].slice(0, 32));
    const echo: ConsoleLine = { text: `C:\\> ${cmd}`, kind: 'in' };
    const result = execute(cmd);
    if (result.length === 1 && result[0].text === '__CLEAR__') {
      setLines([]);
      return;
    }
    setLines((prev) => [...prev, echo, ...result]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // never leak keystrokes into the game
    if (e.key === 'Enter') {
      submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(next);
      setInput(history[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = historyIdx - 1;
      setHistoryIdx(next);
      setInput(next >= 0 ? history[next] : '');
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="console-layer">
      <div className="console-panel mono" role="dialog" aria-label="カーネル回復コンソール">
        <div className="console-head">
          <div className="console-dots"><i /><i /><i /></div>
          <div className="console-title">KERNEL RECOVERY CONSOLE — 0x000000F4</div>
          <button className="console-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <div className="console-body">
          <div className="console-scroll" ref={scrollRef}>
            {lines.map((l, i) => (
              <div key={i} className={`cline cline-${l.kind}`}>{l.text}</div>
            ))}
          </div>
          <div className="console-inputrow">
            <span className="console-prompt">C:\&gt;</span>
            <input
              ref={inputRef}
              className="console-input"
              value={input}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="コンソール入力"
            />
          </div>
        </div>
        <div className="console-foot">ESC / C — 閉じる　↑↓ — 履歴</div>
      </div>
    </div>
  );
}

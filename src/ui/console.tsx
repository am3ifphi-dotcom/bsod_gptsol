import { useEffect, useRef } from "react";
import type { LogLine } from "../game/engine";

interface Props {
  open: boolean;
  lines: LogLine[];
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  found: boolean;
}

export const ConsoleOverlay = ({ open, lines, value, onChange, onSubmit, found }: Props) => {
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines, open]);

  if (!open) return null;

  return (
    <div id="console">
      <div className="wrap">
        <div className="head">
          <b>NULL_STUDIO // kernel console</b>
          <span>session 02:47 · {found ? "WAKE_UP unlocked" : "no target"}</span>
        </div>
        <div className="log" ref={logRef}>
          {lines.map((l) => (
            <div key={l.id} className={`line ${l.kind}`}>
              {l.text}
            </div>
          ))}
        </div>
        <div className="inputrow">
          <span className="caret-sym">&gt;</span>
          <input
            ref={inputRef}
            value={value}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder={found ? "wake_up" : "help"}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit(value);
              }
            }}
          />
        </div>
        <div className="foot">Enter 実行 · Esc 閉じる · 上矢印で履歴はありません</div>
      </div>
    </div>
  );
};

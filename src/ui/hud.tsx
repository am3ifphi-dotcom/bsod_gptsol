import { useEffect, useRef } from "react";
import type { UIState } from "../game/engine";

export const Crosshair = ({ show, hot }: { show: boolean; hot: boolean }) => (
  <div id="crosshair" className={`${show ? "" : "hidden"} ${hot ? "hot" : ""}`} />
);

export const Prompt = ({ prompt }: { prompt: UIState["prompt"] }) => (
  <div id="prompt" className={prompt ? "show" : ""}>
    {prompt && (
      <>
        <span className="key">{prompt.hint}</span>
        <span>{prompt.label}</span>
      </>
    )}
  </div>
);

export const Subtitles = ({ subtitle }: { subtitle: UIState["subtitle"] }) => (
  <div id="subtitle" className={subtitle ? "show" : ""} key={subtitle?.key ?? 0}>
    {subtitle && (
      <>
        <div>{subtitle.text}</div>
        {subtitle.sub && <div className="quiet">{subtitle.sub}</div>}
      </>
    )}
  </div>
);

export const Objective = ({ text }: { text: string | null }) => (
  <div id="objective" className={text ? "show" : ""}>
    {text && (
      <div>
        <span className="tick" />
        {text}
      </div>
    )}
  </div>
);

export const Hint = ({ text }: { text: string | null }) => (
  <div id="hint" className={text ? "show" : ""}>
    {text}
  </div>
);

export const CorruptionBar = ({ value, show }: { value: number; show: boolean }) => (
  <div id="corruption" className={show ? "show" : ""}>
    <i style={{ width: `${Math.round(value * 100)}%` }} />
  </div>
);

export const AreaCard = ({ card }: { card: UIState["areaCard"] }) => (
  <div id="area-card" className={card ? "show" : ""} key={card?.key ?? 0}>
    {card && (
      <>
        <div className="jp">{card.jp}</div>
        <div className="en">{card.en}</div>
      </>
    )}
  </div>
);

export const Cursor = ({ show, hot }: { show: boolean; hot: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const el = ref.current;
      if (el) el.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
    };
    window.addEventListener("mousemove", move, { passive: true });
    return () => window.removeEventListener("mousemove", move);
  }, []);
  return (
  <div id="cursor" ref={ref} className={show ? "show" : ""}>
    <svg width="22" height="22" viewBox="0 0 22 22">
      <path
        d="M4 2 L4 17 L8.2 13.2 L10.6 19.4 L13.2 18.3 L10.9 12.3 L16.2 12.1 Z"
        fill={hot ? "#eaf6ff" : "#ffffff"}
        stroke={hot ? "#3f9bff" : "rgba(0,0,0,0.75)"}
        strokeWidth="1.1"
      />
    </svg>
  </div>
  );
};

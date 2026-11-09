export type Phase =
  | 'boot'
  | 'title'
  | 'room'
  | 'examine'
  | 'devoured'
  | 'world'
  | 'collapse'
  | 'returned';

export interface Settings {
  /** 0..100 */
  volume: number;
  quality: 'high' | 'low';
  reducedFlash: boolean;
}

export interface EngineEvents {
  onPhase(phase: Phase): void;
  /** Contextual prompt (bottom center). null hides it. */
  onPrompt(text: string | null): void;
  /** Transient toast line. */
  onToast(text: string, ms?: number): void;
  /** Cinematic subtitle / forced center line. null clears. */
  onSubtitle(text: string | null): void;
  onConsoleOpen(open: boolean): void;
  onPauseRequest(): void;
  /** Small objective line (top-left). null hides. */
  onObjective(text: string | null): void;
  /** 0..8 corruption clicks */
  onCorruption(level: number): void;
  /** First time the player reads WAKE_UP */
  onWakeDiscovered(): void;
  /** Player pressed R after the ending */
  onRequestRestart(): void;
}

export interface ConsoleLine {
  text: string;
  kind: 'in' | 'out' | 'err' | 'ok' | 'sys' | 'dim';
}

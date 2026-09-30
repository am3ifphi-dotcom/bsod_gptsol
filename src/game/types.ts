export type Phase =
  | 'title'
  | 'entering'
  | 'room'
  | 'approach'
  | 'focus'
  | 'swallow'
  | 'world'
  | 'collapse'
  | 'returned';

export interface GameSnapshot {
  phase: Phase;
  paused: boolean;
  consoleOpen: boolean;
  pointerLocked: boolean;
  nearPC: boolean;
  faceHovered: boolean;
  progress: number;
  discovered: boolean;
  message: string;
}

export interface GamePreferences {
  volume: number;
  muted: boolean;
  gentle: boolean;
  quality: 'high' | 'low';
}

export const initialSnapshot: GameSnapshot = {
  phase: 'title',
  paused: false,
  consoleOpen: false,
  pointerLocked: false,
  nearPC: false,
  faceHovered: false,
  progress: 0,
  discovered: false,
  message: '',
};

export const isPlayable = (phase: Phase) =>
  phase === 'room' || phase === 'world' || phase === 'returned';

export const isCinematic = (phase: Phase) =>
  phase === 'entering' ||
  phase === 'approach' ||
  phase === 'swallow' ||
  phase === 'collapse';
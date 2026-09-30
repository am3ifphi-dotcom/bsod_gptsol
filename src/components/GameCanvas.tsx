import { useEffect, useRef } from 'react';
import { GameEngine } from '../game/Engine';
import type { GamePreferences, GameSnapshot } from '../game/types';

interface Props {
  preferences: GamePreferences;
  onReady: (engine: GameEngine | null) => void;
  onUpdate: (snapshot: GameSnapshot) => void;
  onError: (message: string) => void;
}

export default function GameCanvas({ preferences, onReady, onUpdate, onError }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<GameEngine | null>(null);
  const latestPreferences = useRef(preferences);
  latestPreferences.current = preferences;

  useEffect(() => {
    if (!container.current) return;
    try {
      engine.current = new GameEngine(container.current, latestPreferences.current, onUpdate, onError);
      onReady(engine.current);
    } catch {
      onError('このブラウザでは3D画面を起動できませんでした。WebGL対応のブラウザと、ハードウェアアクセラレーションをご利用ください。');
    }
    return () => {
      engine.current?.dispose();
      engine.current = null;
      onReady(null);
    };
  }, [onReady, onUpdate, onError]);

  useEffect(() => {
    engine.current?.setPreferences(preferences);
  }, [preferences]);

  return <div ref={container} className="game-canvas" />;
}
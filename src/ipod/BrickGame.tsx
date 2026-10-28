import { useEffect, useRef } from "react";
import { drawGame, tick, type BrickGame as BrickState } from "../brick.ts";

export type Hud = { score: number; balls: number; playing: boolean; over: boolean };

export const EMPTY_HUD: Hud = { score: 0, balls: 3, playing: false, over: false };

export function hudFrom(game: BrickState): Hud {
  return { score: game.score, balls: game.balls, playing: game.playing, over: game.over };
}

export function BrickPane({
  live,
  snapshot,
  gameRef,
  onFrame,
}: {
  live: boolean;
  snapshot: BrickState | null;
  gameRef: { current: BrickState };
  onFrame: (game: BrickState) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const paint = (game: BrickState) => drawGame(context, game, canvas.width, canvas.height);

    if (!live) {
      if (snapshot) paint(snapshot);
      return;
    }

    paint(gameRef.current);
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      const next = tick(gameRef.current, dt);
      if (next !== gameRef.current) {
        gameRef.current = next;
        onFrameRef.current(next);
      }
      paint(gameRef.current);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [live, snapshot, gameRef]);

  return <canvas ref={canvasRef} width={526} height={360} aria-hidden={live ? undefined : true} />;
}

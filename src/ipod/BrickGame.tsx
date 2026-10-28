import { useEffect, useEffectEvent, useRef } from "react";
import { drawGame } from "../brick/draw.ts";
import type { BrickGame as BrickState } from "../brick/geom.ts";
import { clearAccumulator, tick } from "../brick/sim.ts";

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
  const report = useEffectEvent((game: BrickState) => {
    onFrame(game);
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

    clearAccumulator(gameRef.current);
    paint(gameRef.current);
    let frame = 0;
    let last = performance.now();

    const loop = (now: number) => {
      if (document.hidden) {
        frame = 0;
        last = 0;
        clearAccumulator(gameRef.current);
        return;
      }
      if (last === 0) {
        last = now;
        paint(gameRef.current);
        frame = requestAnimationFrame(loop);
        return;
      }
      const dt = now - last;
      last = now;
      const game = gameRef.current;
      const score = game.score;
      const balls = game.balls;
      const playing = game.playing;
      const over = game.over;
      tick(game, dt);
      if (score !== game.score || balls !== game.balls || playing !== game.playing || over !== game.over) {
        report(game);
      }
      paint(game);
      frame = requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      clearAccumulator(gameRef.current);
      if (!document.hidden) frame = requestAnimationFrame(loop);
    };

    document.addEventListener("visibilitychange", onVisibility);
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [live, snapshot, gameRef]);

  return <canvas ref={canvasRef} width={526} height={360} aria-hidden={live ? undefined : true} />;
}

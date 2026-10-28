const FIELD_W = 148;
const FIELD_H = 101;
const PADDLE_W = 30;
const PADDLE_H = 3.2;
const BALL_R = 1.7;
const PADDLE_Y = FIELD_H - 8;

export { BALL_R, FIELD_H, FIELD_W, PADDLE_H, PADDLE_W, PADDLE_Y };

export type Brick = { x: number; y: number; w: number; h: number; live: boolean };
export type Ball = { x: number; y: number; vx: number; vy: number };
export type Steer = -1 | 0 | 1;

export type BrickGame = {
  width: number;
  height: number;
  paddleX: number;
  paddleW: number;
  ball: Ball;
  playing: boolean;
  over: boolean;
  bricks: Brick[];
  score: number;
  balls: number;
  speed: number;
  steer: Steer;
  steerStepped: boolean;
  accumulator: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function makeBricks(): Brick[] {
  const cols = 8;
  const rowCount = 4;
  const gap = 1.6;
  const margin = 3;
  const width = (FIELD_W - margin * 2 - gap * (cols - 1)) / cols;
  const height = 4.4;
  const bricks: Brick[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      bricks.push({
        x: margin + col * (width + gap),
        y: 5 + row * (height + gap),
        w: width,
        h: height,
        live: true,
      });
    }
  }
  return bricks;
}

export function placeParked(ball: Ball, paddleX: number) {
  ball.x = paddleX + PADDLE_W / 2;
  ball.y = PADDLE_Y - BALL_R - 0.4;
  ball.vx = 0.7;
  ball.vy = -1.15;
}

export function createGame(): BrickGame {
  const paddleX = (FIELD_W - PADDLE_W) / 2;
  const ball: Ball = { x: 0, y: 0, vx: 0, vy: 0 };
  placeParked(ball, paddleX);
  return {
    width: FIELD_W,
    height: FIELD_H,
    paddleX,
    paddleW: PADDLE_W,
    ball,
    playing: false,
    over: false,
    bricks: makeBricks(),
    score: 0,
    balls: 3,
    speed: 1,
    steer: 0,
    steerStepped: false,
    accumulator: 0,
  };
}

/** Deep copy so a slide-out frame does not follow later in-place ticks. */
export function cloneGame(game: BrickGame): BrickGame {
  return {
    ...game,
    ball: { ...game.ball },
    bricks: game.bricks.map((brick) => ({ ...brick })),
  };
}

export function setPaddleX(game: BrickGame, paddleX: number) {
  if (game.over) return;
  const travel = game.width - game.paddleW;
  game.paddleX = clamp(paddleX, 0, travel);
  if (!game.playing) placeParked(game.ball, game.paddleX);
}

export function movePaddle(game: BrickGame, degrees: number): BrickGame {
  if (game.over) return game;
  const travel = game.width - game.paddleW;
  setPaddleX(game, game.paddleX + (degrees / 360) * travel);
  return game;
}

export function launch(game: BrickGame): BrickGame {
  if (game.over) {
    const next = createGame();
    next.steer = game.steer;
    next.steerStepped = game.steerStepped;
    return next;
  }
  if (game.playing) return game;
  placeParked(game.ball, game.paddleX);
  const magnitude = Math.hypot(game.ball.vx, game.ball.vy) || 1;
  game.ball.vx /= magnitude;
  game.ball.vy /= magnitude;
  game.playing = true;
  return game;
}

export function clampAlong(value: number, min: number, max: number) {
  return clamp(value, min, max);
}

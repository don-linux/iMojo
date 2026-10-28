import {
  BALL_R,
  FIELD_H,
  FIELD_W,
  PADDLE_Y,
  clampAlong,
  makeBricks,
  placeParked,
  setPaddleX,
  type BrickGame,
  type Steer,
} from "./geom.ts";

/** Fixed step. At MAX_SPEED one step is 0.6px, under the 4.4px brick height. */
export const STEP_MS = 1000 / 120;

/** Stalled frames simulate at most this many steps and drop the rest. */
export const MAX_STEPS = 12;

/** Logical px/ms at speed 1 (48 px/s), the previous `dt * 0.048` scale. */
export const PX_PER_MS = 0.048;

/** Bundle level timer stops shortening at 1.5× the level-1 rate. */
export const MAX_SPEED = 1.5;

const SPEED_PER_CLEAR = 0.18;

/** Bundle keyboard steer: 0.035 of paddle travel per 40ms at level 1. */
const STEER_PER_MS = 0.035 / 40;

function steerDelta(travel: number, steer: Steer, ms: number) {
  return steer * STEER_PER_MS * travel * ms;
}

function integrate(game: BrickGame) {
  if (!game.playing || game.over) return;

  const ball = game.ball;
  let { x, y, vx, vy } = ball;
  const distance = STEP_MS * PX_PER_MS * game.speed;
  const magnitude = Math.hypot(vx, vy) || 1;
  const previousY = y;
  x += (vx / magnitude) * distance;
  y += (vy / magnitude) * distance;

  if (x < BALL_R) {
    x = BALL_R;
    vx = Math.abs(vx);
  } else if (x > FIELD_W - BALL_R) {
    x = FIELD_W - BALL_R;
    vx = -Math.abs(vx);
  }
  if (y < BALL_R) {
    y = BALL_R;
    vy = Math.abs(vy);
  }

  const crossedPaddle =
    vy > 0 &&
    previousY <= PADDLE_Y &&
    y + BALL_R >= PADDLE_Y &&
    x >= game.paddleX - BALL_R &&
    x <= game.paddleX + game.paddleW + BALL_R;

  if (crossedPaddle) {
    const along = clampAlong((x - game.paddleX) / game.paddleW, 0, 1) * 2 - 1;
    vx = along * 1.4;
    vy = -1;
    y = PADDLE_Y - BALL_R - 0.2;
  }

  if (y > FIELD_H + BALL_R) {
    ball.x = x;
    ball.y = y;
    ball.vx = vx;
    ball.vy = vy;
    const balls = game.balls - 1;
    if (balls <= 0) {
      game.balls = 0;
      game.playing = false;
      game.over = true;
      return;
    }
    game.balls = balls;
    game.playing = false;
    game.over = false;
    placeParked(ball, game.paddleX);
    return;
  }

  for (const brick of game.bricks) {
    if (!brick.live) continue;
    const hits =
      x + BALL_R > brick.x &&
      x - BALL_R < brick.x + brick.w &&
      y + BALL_R > brick.y &&
      y - BALL_R < brick.y + brick.h;
    if (!hits) continue;
    brick.live = false;
    game.score += 1;
    const centerX = brick.x + brick.w / 2;
    const centerY = brick.y + brick.h / 2;
    if (Math.abs(x - centerX) / brick.w > Math.abs(y - centerY) / brick.h) {
      vx = Math.sign(x - centerX || vx) * Math.abs(vx || 0.8);
    } else {
      vy = Math.sign(y - centerY || vy) * Math.abs(vy || 0.8);
    }
    break;
  }

  if (game.bricks.every((brick) => !brick.live)) {
    game.bricks = makeBricks();
    game.speed = Math.min(MAX_SPEED, game.speed + SPEED_PER_CLEAR);
    game.playing = false;
    placeParked(ball, game.paddleX);
    return;
  }

  ball.x = x;
  ball.y = y;
  ball.vx = vx;
  ball.vy = vy;
}

function fixedStep(game: BrickGame) {
  if (game.steer !== 0) {
    const travel = game.width - game.paddleW;
    setPaddleX(game, game.paddleX + steerDelta(travel, game.steer, STEP_MS));
    game.steerStepped = true;
  }
  integrate(game);
}

export function clearAccumulator(game: BrickGame): BrickGame {
  game.accumulator = 0;
  return game;
}

export function setSteer(game: BrickGame, steer: Steer): BrickGame {
  if (steer === game.steer) return game;
  if (!game.over && steer === 0 && !game.steerStepped) {
    const travel = game.width - game.paddleW;
    setPaddleX(game, game.paddleX + steerDelta(travel, game.steer, STEP_MS));
  }
  game.steer = steer;
  game.steerStepped = false;
  return game;
}

export function tick(game: BrickGame, dt: number): BrickGame {
  if (game.over) return game;
  if (!Number.isFinite(dt) || dt <= 0) return game;
  if (!game.playing && game.steer === 0) {
    game.accumulator = 0;
    return game;
  }

  let acc = game.accumulator + dt;
  const cap = STEP_MS * MAX_STEPS;
  if (acc > cap) acc = cap;

  let steps = 0;
  while (acc >= STEP_MS && steps < MAX_STEPS) {
    acc -= STEP_MS;
    steps += 1;
    fixedStep(game);
    if (game.over) {
      acc = 0;
      break;
    }
  }
  game.accumulator = acc > 0 ? acc : 0;
  return game;
}

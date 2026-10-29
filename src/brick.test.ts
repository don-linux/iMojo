import assert from "node:assert/strict";
import test from "node:test";
import { BALL_R, cloneGame, createGame, launch, movePaddle, type BrickGame } from "./brick/geom.ts";
import { MAX_SPEED, MAX_STEPS, PX_PER_MS, STEP_MS, setSteer, tick } from "./brick/sim.ts";

function advance(game: BrickGame, slice: number, total: number) {
  let elapsed = 0;
  while (elapsed + slice <= total) {
    tick(game, slice);
    elapsed += slice;
  }
  const rest = total - elapsed;
  if (rest > 0) tick(game, rest);
}

function flying(): BrickGame {
  const game = launch(createGame());
  game.ball.x = 40;
  game.ball.y = 60;
  game.ball.vx = 1;
  game.ball.vy = 0;
  game.accumulator = 0;
  return game;
}

test("1000ms at 16ms and 8.33ms slices stays within one fixed step", () => {
  const slow = flying();
  const fast = cloneGame(slow);
  const shot = cloneGame(slow);
  advance(slow, 16, 1000);
  advance(fast, 8.33, 1000);
  const gap = Math.hypot(slow.ball.x - fast.ball.x, slow.ball.y - fast.ball.y);
  const step = STEP_MS * PX_PER_MS;
  assert.ok(gap <= step + 1e-6, `gap ${gap} exceeds one step ${step}`);
  assert.equal(shot.ball.x, 40);
  assert.ok(Math.abs(slow.ball.x - 40 - 1000 * PX_PER_MS) <= step + 1e-6);
  assert.ok(Math.abs(fast.ball.x - 40 - 1000 * PX_PER_MS) <= step + 1e-6);
  assert.equal(slow.ball.y, 60);
  assert.equal(fast.ball.y, 60);
});

test("a single 5000ms frame advances at most MAX_STEPS", () => {
  const game = flying();
  const x0 = game.ball.x;
  assert.equal(tick(game, 5000), game);
  const moved = game.ball.x - x0;
  const perStep = STEP_MS * PX_PER_MS;
  assert.ok(moved <= MAX_STEPS * perStep + 1e-6);
  assert.ok(moved > (MAX_STEPS - 1) * perStep);
  const parked = game.ball.x;
  tick(game, 0);
  assert.equal(game.ball.x, parked);
  tick(game, STEP_MS);
  assert.ok(game.ball.x - parked <= perStep * 2 + 1e-6);
});

test("steer applies per step and a quick press still nudges", () => {
  const held = setSteer(createGame(), 1);
  const travel = held.width - held.paddleW;
  const quantum = 0.035 * travel * (STEP_MS / 40);
  const start = held.paddleX;
  tick(held, STEP_MS);
  assert.ok(Math.abs(held.paddleX - start - quantum) < 1e-6);
  assert.equal(held.ball.x, held.paddleX + held.paddleW / 2);
  tick(held, STEP_MS);
  assert.ok(Math.abs(held.paddleX - start - quantum * 2) < 1e-6);
  const released = held.paddleX;
  setSteer(held, 0);
  assert.equal(held.paddleX, released);

  const tap = createGame();
  const tapStart = tap.paddleX;
  setSteer(tap, -1);
  setSteer(tap, 0);
  assert.ok(Math.abs(tapStart - tap.paddleX - quantum) < 1e-6);
  assert.equal(tap.steer, 0);
});

test("speed never exceeds the cap after many level clears", () => {
  const game = createGame();
  for (let i = 0; i < 40; i += 1) {
    const brick = game.bricks[0];
    for (const item of game.bricks) item.live = item === brick;
    game.playing = true;
    game.over = false;
    game.ball.x = brick.x + brick.w / 2;
    game.ball.y = brick.y + brick.h / 2;
    game.ball.vx = 0;
    game.ball.vy = 1;
    tick(game, STEP_MS);
    assert.ok(game.speed <= MAX_SPEED);
  }
  assert.equal(game.speed, MAX_SPEED);
});

test("a fast ball does not pass through a brick row", () => {
  const game = createGame();
  const brick = game.bricks[4];
  const speed = 8;
  const euler = 34 * PX_PER_MS * speed;
  assert.ok(euler > brick.h + BALL_R * 2);
  game.playing = true;
  game.speed = speed;
  game.ball.x = brick.x + brick.w / 2;
  game.ball.y = brick.y - BALL_R - 0.05;
  game.ball.vx = 0;
  game.ball.vy = 1;
  tick(game, 34);
  assert.equal(brick.live, false);
  assert.equal(game.score, 1);
  assert.ok(game.ball.y < brick.y + brick.h + BALL_R);
});

test("game over keeps the steer value but does not move the paddle", () => {
  const over = createGame();
  over.over = true;
  const x = over.paddleX;
  setSteer(over, -1);
  assert.equal(over.paddleX, x);
  assert.equal(over.steer, -1);
  const restarted = launch(over);
  assert.notEqual(restarted, over);
  assert.equal(restarted.steer, -1);
  tick(restarted, STEP_MS);
  assert.ok(restarted.paddleX < x);

  setSteer(over, 0);
  assert.equal(over.steer, 0);
  assert.equal(launch(over).steer, 0);
});

test("wheel degrees still map across the full paddle travel", () => {
  const right = createGame();
  movePaddle(right, 360);
  assert.equal(right.paddleX, right.width - right.paddleW);
  const left = createGame();
  movePaddle(left, -360);
  assert.equal(left.paddleX, 0);
  assert.equal(left.ball.x, left.paddleX + left.paddleW / 2);
});

export {
  cloneGame,
  createGame,
  launch,
  movePaddle,
  type Ball,
  type Brick,
  type BrickGame,
  type Steer,
} from "./brick/geom.ts";
export {
  MAX_SPEED,
  MAX_STEPS,
  PX_PER_MS,
  STEP_MS,
  clearAccumulator,
  setSteer,
  tick,
} from "./brick/sim.ts";
export { drawGame } from "./brick/draw.ts";

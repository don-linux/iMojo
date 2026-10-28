const FIELD_W = 148;
const FIELD_H = 101;
const PADDLE_W = 30;
const PADDLE_H = 3.2;
const BALL_R = 1.7;
const PADDLE_Y = FIELD_H - 8;

export type Brick = { x: number; y: number; w: number; h: number; live: boolean };
export type Ball = { x: number; y: number; vx: number; vy: number };

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
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function makeBricks(): Brick[] {
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

function parked(paddleX: number): Ball {
  return {
    x: paddleX + PADDLE_W / 2,
    y: PADDLE_Y - BALL_R - 0.4,
    vx: 0.7,
    vy: -1.15,
  };
}

export function createGame(): BrickGame {
  const paddleX = (FIELD_W - PADDLE_W) / 2;
  return {
    width: FIELD_W,
    height: FIELD_H,
    paddleX,
    paddleW: PADDLE_W,
    ball: parked(paddleX),
    playing: false,
    over: false,
    bricks: makeBricks(),
    score: 0,
    balls: 3,
    speed: 1,
  };
}

export function movePaddle(game: BrickGame, degrees: number): BrickGame {
  if (game.over) return game;
  const travel = game.width - game.paddleW;
  const paddleX = clamp(game.paddleX + (degrees / 360) * travel, 0, travel);
  if (game.playing) return { ...game, paddleX };
  return { ...game, paddleX, ball: parked(paddleX) };
}

export function launch(game: BrickGame): BrickGame {
  if (game.over) return createGame();
  if (game.playing) return game;
  const ball = parked(game.paddleX);
  const magnitude = Math.hypot(ball.vx, ball.vy) || 1;
  return {
    ...game,
    playing: true,
    ball: { ...ball, vx: ball.vx / magnitude, vy: ball.vy / magnitude },
  };
}

export function tick(game: BrickGame, dt: number): BrickGame {
  if (!game.playing || game.over) return game;

  const bricks = game.bricks.map((brick) => ({ ...brick }));
  let { x, y, vx, vy } = game.ball;
  let score = game.score;
  const step = Math.min(dt, 34) * 0.048 * game.speed;
  const magnitude = Math.hypot(vx, vy) || 1;
  const previousY = y;
  x += (vx / magnitude) * step;
  y += (vy / magnitude) * step;

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
    const along = clamp((x - game.paddleX) / game.paddleW, 0, 1) * 2 - 1;
    vx = along * 1.4;
    vy = -1;
    y = PADDLE_Y - BALL_R - 0.2;
  }

  if (y > FIELD_H + BALL_R) {
    const balls = game.balls - 1;
    if (balls <= 0) {
      return {
        ...game,
        ball: { x, y, vx, vy },
        bricks,
        score,
        balls: 0,
        playing: false,
        over: true,
      };
    }
    return {
      ...game,
      bricks,
      score,
      balls,
      playing: false,
      over: false,
      ball: parked(game.paddleX),
    };
  }

  for (const brick of bricks) {
    if (!brick.live) continue;
    const hits =
      x + BALL_R > brick.x &&
      x - BALL_R < brick.x + brick.w &&
      y + BALL_R > brick.y &&
      y - BALL_R < brick.y + brick.h;
    if (!hits) continue;
    brick.live = false;
    score += 1;
    const centerX = brick.x + brick.w / 2;
    const centerY = brick.y + brick.h / 2;
    if (Math.abs(x - centerX) / brick.w > Math.abs(y - centerY) / brick.h) {
      vx = Math.sign(x - centerX || vx) * Math.abs(vx || 0.8);
    } else {
      vy = Math.sign(y - centerY || vy) * Math.abs(vy || 0.8);
    }
    break;
  }

  if (bricks.every((brick) => !brick.live)) {
    return {
      ...game,
      bricks: makeBricks(),
      score,
      speed: game.speed + 0.18,
      playing: false,
      ball: parked(game.paddleX),
    };
  }

  return { ...game, ball: { x, y, vx, vy }, bricks, score };
}

export function drawGame(
  ctx: CanvasRenderingContext2D,
  game: BrickGame,
  width: number,
  height: number,
) {
  const scaleX = width / game.width;
  const scaleY = height / game.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#484647";

  for (const brick of game.bricks) {
    if (!brick.live) continue;
    ctx.fillRect(
      brick.x * scaleX,
      brick.y * scaleY,
      brick.w * scaleX - 0.5,
      brick.h * scaleY - 0.5,
    );
  }

  ctx.fillRect(game.paddleX * scaleX, PADDLE_Y * scaleY, game.paddleW * scaleX, PADDLE_H * scaleY);
  ctx.beginPath();
  ctx.arc(
    game.ball.x * scaleX,
    game.ball.y * scaleY,
    BALL_R * ((scaleX + scaleY) / 2),
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (game.over) {
    ctx.font = `700 ${Math.round(height * 0.13)}px system-ui, Helvetica, Arial, sans-serif`;
    ctx.fillText("GAME OVER", width / 2, height * 0.62);
    return;
  }
  if (!game.playing) {
    ctx.font = `600 ${Math.round(height * 0.07)}px system-ui, Helvetica, Arial, sans-serif`;
    ctx.fillText("Press Center to Launch Ball", width / 2, height * 0.7);
  }
}

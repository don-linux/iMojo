import { BALL_R, PADDLE_H, PADDLE_Y, type BrickGame } from "./geom.ts";

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

export function drawTurnoutLockIndicator(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  locked: boolean
): void {
  if (!locked) {
    return;
  }

  ctx.save();

  // The Layout page already redraws every 225 ms while a SwitchMan lock is
  // active (same animation tick used by level-crossing lamps). Keep the blink
  // phase time-based so unrelated redraws cannot change its cadence.
  const blinkOn =
    Math.floor(Date.now() / 450) % 2 === 0;

  if (blinkOn) {
    ctx.beginPath();
    ctx.fillStyle = "rgba(255, 0, 0, 0.92)";
    ctx.strokeStyle = "#7f1d1d";
    ctx.lineWidth = 1.0;
    ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  // Preserve the original white turnout-center marker above the warning halo.
  ctx.beginPath();
  ctx.fillStyle = "white";
  ctx.strokeStyle = "black";
  ctx.lineWidth = 1;
  ctx.arc(centerX, centerY, 3, 0, 2 * Math.PI);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

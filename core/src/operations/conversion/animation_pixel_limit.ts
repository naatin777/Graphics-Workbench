/**
 * Enforces the aggregate animated-input pixel limit (width * pageHeight *
 * frameCount) before a conversion that keeps all frames in memory.
 *
 * The invariant lives in core, not in a UI adapter, so every frontend and
 * future headless client is protected even when it builds conversion
 * inputs without consulting adapter-level settings.
 */
export function assertAnimationPixelLimit(
  width: number,
  pageHeight: number,
  frameCount: number,
  maxAnimationPixels: number,
  sourcePath: string,
): void {
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(pageHeight) ||
    pageHeight < 1 ||
    !Number.isSafeInteger(frameCount) ||
    frameCount < 1
  ) {
    throw new Error(`Could not determine safe animation dimensions: ${sourcePath}`);
  }

  const totalPixels = BigInt(width) * BigInt(pageHeight) * BigInt(frameCount);
  if (totalPixels > BigInt(maxAnimationPixels)) {
    throw new Error(
      [
        'The animated raster input exceeds the configured total animation pixel limit.',
        '',
        `Configured limit: ${maxAnimationPixels.toLocaleString('en-US')} pixels`,
        `Animation pixels: ${totalPixels.toString()} pixels`,
        `Input: ${sourcePath}`,
      ].join('\n'),
    );
  }
}

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const visualReviewRoot = resolve(process.cwd(), 'artifacts', 'visual-review');

/**
 * Directory for generated visual review screenshots, separated per OS and CPU.
 * These files are git-ignored review artifacts, not pixel comparison baselines.
 */
export function visualReviewEnvironmentDirectory(): string {
  return join(visualReviewRoot, `${process.platform}-${process.arch}`);
}

/**
 * Writes a screenshot buffer under `artifacts/visual-review/<platform>-<arch>/`.
 * Throws with the target path so a capture failure is clearly attributable.
 */
export async function writeVisualReviewScreenshot(name: string, body: Buffer): Promise<string> {
  const directory = visualReviewEnvironmentDirectory();
  const outputPath = join(directory, name);
  await mkdir(directory, { recursive: true });
  await writeFile(outputPath, body);
  return outputPath;
}

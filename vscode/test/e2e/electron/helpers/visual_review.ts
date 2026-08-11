import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { projectRootDirectory } from '../../../support/helpers/fixture_paths.js';

export type VisualReviewViewport = 'wide' | 'narrow';

const visualReviewRoot = resolve(projectRootDirectory, 'artifacts', 'visual-review');

/**
 * Directory for generated visual review screenshots, separated per OS and CPU.
 * These files are git-ignored review artifacts, not pixel comparison baselines.
 */
export function visualReviewEnvironmentDirectory(): string {
  return join(visualReviewRoot, `${process.platform}-${process.arch}`);
}

function visualReviewViewportDirectory(viewport: VisualReviewViewport): string {
  return join(visualReviewEnvironmentDirectory(), viewport);
}

/**
 * Prepares the generated output directory for this OS/CPU before a capture run.
 * Only the `wide/` and `narrow/` PNGs for this platform and architecture are cleared.
 */
export async function initializeVisualReviewOutput(): Promise<void> {
  const environmentDirectory = visualReviewEnvironmentDirectory();
  await mkdir(environmentDirectory, { recursive: true });

  for (const viewport of ['wide', 'narrow'] as const) {
    const viewportDirectory = visualReviewViewportDirectory(viewport);
    await mkdir(viewportDirectory, { recursive: true });
    const entries = await readdir(viewportDirectory).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.toLowerCase().endsWith('.png'))
        .map((entry) => rm(join(viewportDirectory, entry), { force: true })),
    );
  }
}

/**
 * Writes a screenshot buffer under
 * `artifacts/visual-review/<platform>-<arch>/<viewport>/`.
 * Throws with the target path so a capture failure is clearly attributable.
 */
export async function writeVisualReviewScreenshot(
  viewport: VisualReviewViewport,
  name: string,
  body: Buffer,
): Promise<string> {
  const directory = visualReviewViewportDirectory(viewport);
  const outputPath = join(directory, name);
  await mkdir(directory, { recursive: true });
  await writeFile(outputPath, body);
  return outputPath;
}

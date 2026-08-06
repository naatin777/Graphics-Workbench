import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type VisualReviewViewport = 'wide' | 'narrow';

const visualReviewRoot = resolve(process.cwd(), 'artifacts', 'visual-review');

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
 * Only this platform-arch tree is cleared: the `wide/` and `narrow/` PNGs for
 * this run plus any legacy flat PNGs left directly under the platform-arch
 * directory. The artifacts of other platforms or architectures are never
 * touched.
 */
export async function initializeVisualReviewOutput(): Promise<void> {
  const environmentDirectory = visualReviewEnvironmentDirectory();
  await mkdir(environmentDirectory, { recursive: true });

  const legacyEntries = await readdir(environmentDirectory).catch(() => []);
  await Promise.all(
    legacyEntries
      .filter((entry) => entry.toLowerCase().endsWith('.png'))
      .map((entry) => rm(join(environmentDirectory, entry), { force: true })),
  );

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

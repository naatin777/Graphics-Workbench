import path from 'node:path';

import { sourceFormatForPath } from '@graphics-workbench/core/formats';
import { executeRasterConversion, rasterFormatSpecs } from '@graphics-workbench/core/conversion';
import {
  assertRasterMatches,
  copyInputToWorkspace,
  createTestRuntime,
  listInputFixturePathsSync,
  readConfiguredConversionTools,
  testInputDirectory,
  testOutputDirectory,
  withTestWorkspace,
  requireConfiguredTool,
} from '@graphics-workbench/core/testing';

describe('SVG fixtureをPNGへ変換して固定正解と比較する', () => {
  for (const [index, fixturePath] of listInputFixturePathsSync(path.join(testInputDirectory, 'valid', 'svg'))
    .filter((candidatePath) => sourceFormatForPath(candidatePath) === 'svg')
    .entries()) {
    it(`svg/${path.basename(fixturePath)}をworkspaceへコピーしてPNGへ変換すると、renderer差を許容して固定正解expected.pngと内容が一致する`, async () => {
      const { pdfRenderTools, drawioTools } = readConfiguredConversionTools();
      requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH', 'Draw.io');
      await withTestWorkspace(async (workspacePath) => {
        const sourcePath = await copyInputToWorkspace(
          fixturePath,
          workspacePath,
          workspaceSourcePath(fixturePath, index),
        );
        const outputPath = path.join(workspacePath, 'converted', `svg-${index}.png`);
        const expectedPath = path.join(testOutputDirectory, 'svg', sourceName(fixturePath), 'expected.png');

        await executeRasterConversion({
          spec: rasterFormatSpecs.png,
          maxInputPixels: 1_000_000_000,
          inputs: [{ sourcePath, outputPath, workspacePath }],
          pdfRenderTools,
          drawioTools,
          runtime: createTestRuntime().runtime,
          runId: `svg-${index}`,
        });

        await assertRasterMatches(outputPath, expectedPath, fixturePath, { rendererVariance: true });
      });
    });
  }
});

function workspaceSourcePath(fixturePath: string, index: number): string {
  const extension = path.extname(fixturePath);
  return index % 2 === 0 ? `svg root ${index}${extension}` : `illustrations/éléments 🚀/gradient.${index}${extension}`;
}

function sourceName(fixturePath: string): string {
  return path.basename(fixturePath, path.extname(fixturePath));
}

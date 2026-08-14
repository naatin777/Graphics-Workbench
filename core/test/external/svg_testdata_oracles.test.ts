import path from 'node:path';

import { sourceFormatForPath } from '@graphics-workbench/core/formats';
import { executeRasterConversion, rasterFormatSpecs } from '@graphics-workbench/core/conversion';
import {
  assertRasterMatches,
  copyInputToWorkspace,
  createTestRuntime,
  listInputTestDataPathsSync,
  readConfiguredConversionTools,
  testInputDirectory,
  testOutputDirectory,
  withTestWorkspace,
  requireConfiguredTool,
} from '@graphics-workbench/core/testing';

describe('SVG テストデータをPNGへ変換して固定正解と比較する', () => {
  for (const [index, testDataPath] of listInputTestDataPathsSync(path.join(testInputDirectory, 'valid', 'svg'))
    .filter((candidatePath) => sourceFormatForPath(candidatePath) === 'svg')
    .entries()) {
    it(`svg/${path.basename(testDataPath)}をworkspaceへコピーしてPNGへ変換すると、renderer差を許容して固定正解expected.pngと内容が一致する`, async () => {
      const { pdfRenderTools, drawioTools } = readConfiguredConversionTools();
      requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH', 'Draw.io');
      await withTestWorkspace(async (workspacePath) => {
        const sourcePath = await copyInputToWorkspace(
          testDataPath,
          workspacePath,
          workspaceSourcePath(testDataPath, index),
        );
        const outputPath = path.join(workspacePath, 'converted', `svg-${index}.png`);
        const expectedPath = path.join(testOutputDirectory, 'svg', sourceName(testDataPath), 'expected.png');

        await executeRasterConversion({
          spec: rasterFormatSpecs.png,
          maxInputPixels: 1_000_000_000,
          inputs: [{ sourcePath, outputPath, workspacePath }],
          pdfRenderTools,
          drawioTools,
          runtime: createTestRuntime().runtime,
          runId: `svg-${index}`,
        });

        await assertRasterMatches(outputPath, expectedPath, testDataPath, { rendererVariance: true });
      });
    });
  }
});

function workspaceSourcePath(testDataPath: string, index: number): string {
  const extension = path.extname(testDataPath);
  return index % 2 === 0 ? `svg root ${index}${extension}` : `illustrations/éléments 🚀/gradient.${index}${extension}`;
}

function sourceName(testDataPath: string): string {
  return path.basename(testDataPath, path.extname(testDataPath));
}

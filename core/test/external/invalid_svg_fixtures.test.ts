import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';

import { executeRasterConversion, rasterFormatSpecs } from '@graphics-workbench/core/conversion';
import {
  copyInputToWorkspace,
  createTestRuntime,
  readConfiguredConversionTools,
  requireConfiguredTool,
  testInputDirectory,
  withTestWorkspace,
} from '@graphics-workbench/core/testing';

describe('不正なSVGテスト入力の実変換エラー（Draw.io CLI必須）', () => {
  it('malformed.svgを実際にPNGへ変換すると変換失敗となり、出力ファイルを生成しない', async () => {
    requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH', 'Draw.io');
    const { pdfRenderTools, drawioTools } = readConfiguredConversionTools();

    await withTestWorkspace(async (workspacePath) => {
      const inputPath = path.join(testInputDirectory, 'invalid', 'svg', 'malformed.svg');
      const destinationPath = 'invalid root 8.svg';
      const sourcePath = await copyInputToWorkspace(inputPath, workspacePath, destinationPath);

      const outputPath = path.join(workspacePath, 'invalid input outputs', '8.png');
      const input = executeRasterConversion({
        spec: rasterFormatSpecs.png,
        maxInputPixels: 1_000_000_000,
        inputs: [{ sourcePath, outputPath, workspacePath }],
        pdfRenderTools,
        drawioTools,
        runtime: createTestRuntime().runtime,
        runId: 'invalid-svg-8',
      });

      await assert.rejects(input, 'svg/malformed.svg');
      await assert.rejects(access(outputPath));
    });
  });
});

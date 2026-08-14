import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';

import { convertSplitPng } from '@graphics-workbench/core/conversion';
import {
  copyInputToWorkspace,
  createTestRuntime,
  readConfiguredConversionConfiguration,
  testInputDirectory,
  withTestWorkspace,
} from '@graphics-workbench/core/testing';

describe('不正なSVGテスト入力の実変換エラー（Draw.io CLI必須）', () => {
  it('malformed.svgを実際にPNGへ変換すると変換失敗となり、出力ファイルを生成しない', async () => {
    const configuration = readConfiguredConversionConfiguration();

    await withTestWorkspace(async (workspacePath) => {
      const inputPath = path.join(testInputDirectory, 'invalid', 'svg', 'malformed.svg');
      const destinationPath = 'invalid root 8.svg';
      const sourcePath = await copyInputToWorkspace(inputPath, workspacePath, destinationPath);

      const result = await convertSplitPng(
        [{ sourcePath, workspacePath, workspaceName: path.basename(workspacePath) }],
        '${fileDirname}/invalid input outputs/8.png',
        configuration,
        createTestRuntime().runtime,
      );

      assert.ok(result.isErr(), 'malformed SVG conversion should fail');
      await assert.rejects(access(path.join(workspacePath, 'invalid input outputs', '8.png')));
    });
  });
});

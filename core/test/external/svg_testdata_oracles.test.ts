import path from 'node:path';

import { sourceFormatForPath } from '@graphics-workbench/core/formats';
import { convertSinglePng } from '@graphics-workbench/core/conversion';
import {
  assertRasterMatches,
  copyInputToWorkspace,
  readConfiguredConversionConfiguration,
  listInputTestDataPathsSync,
  testInputDirectory,
  testOutputDirectory,
  withTestWorkspace,
} from '@graphics-workbench/core/testing';

describe('SVG テストデータをPNGへ変換して固定正解と比較する', () => {
  for (const [index, testDataPath] of listInputTestDataPathsSync(path.join(testInputDirectory, 'valid', 'svg'))
    .filter((candidatePath) => sourceFormatForPath(candidatePath) === 'svg')
    .entries()) {
    it(`svg/${path.basename(testDataPath)}をworkspaceへコピーしてPNGへ変換すると、renderer差を許容して固定正解expected.pngと内容が一致する`, async () => {
      const configuration = readConfiguredConversionConfiguration();
      await withTestWorkspace(async (workspacePath) => {
        const sourcePath = await copyInputToWorkspace(
          testDataPath,
          workspacePath,
          workspaceSourcePath(testDataPath, index),
        );
        const outputTemplate = '${fileDirname}/${fileBasenameNoExtension}.png';
        const expectedPath = path.join(testOutputDirectory, 'svg', sourceName(testDataPath), 'expected.png');

        const result = await convertSinglePng(
          [{ sourcePath, workspacePath, workspaceName: path.basename(workspacePath) }],
          outputTemplate,
          configuration,
          {},
        );
        if (result.isErr()) {
          throw result.error;
        }
        const [output] = result.value;
        if (output === undefined) {
          throw new Error('Conversion produced no output.');
        }

        await assertRasterMatches(output.outputPath, expectedPath, testDataPath, { rendererVariance: true });
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

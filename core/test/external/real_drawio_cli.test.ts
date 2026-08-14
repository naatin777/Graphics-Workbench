import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { convertDrawioToSinglePdf, executeDrawio } from '@graphics-workbench/core/conversion';
import { readPdfPages, requireConfiguredTool, testInputDirectory } from '@graphics-workbench/core/testing';

const drawioFixturePath = path.join(testInputDirectory, 'valid', 'drawio', 'unicode-page-names.drawio');

describe('実Draw.io CLIによる全ページPDF変換', () => {
  it('設定されたDraw.io CLIを実際に起動し、全ページを3ページの1つのPDFへ変換する', async () => {
    const drawioPath = requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH', 'Draw.io');

    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-real-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio');
    const outputPath = path.join(workspacePath.path, 'all-pages.pdf');
    await copyFile(drawioFixturePath, sourcePath);

    const outputs = await convertDrawioToSinglePdf({
      inputs: [
        {
          sourcePath,
          outputTemplate: '${fileDirname}/all-pages.pdf',
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      drawioPath,
      runDrawio: executeDrawio,
      runId: 'real-cli-test',
      runtime: { resolveConflicts: async () => 'overwrite' },
    });

    assert.deepStrictEqual(
      outputs.map(({ outputPath: actualPath }) => actualPath),
      [outputPath],
    );
    assert.strictEqual((await readPdfPages(await readFile(outputPath))).length, 3);
  });
});

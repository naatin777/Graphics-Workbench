import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { convertSinglePdf, isConversionCancelled, type ConversionError } from '@graphics-workbench/core/conversion';
import { testConversionConfiguration } from '@graphics-workbench/core/testing';

describe('外部ツールexecPathの未設定（空文字）ガード', () => {
  it('rsvg-convert backendのrsvgConvertPathが空文字なら、実プロセスを起動せずExternalToolErrorで失敗する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-svg-guard-'));
    const sourcePath = path.join(workspacePath.path, 'source.svg');
    await writeFile(sourcePath, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');

    const result = await convertSinglePdf(
      [
        {
          sourcePath,
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      '${fileDirname}/output.pdf',
      testConversionConfiguration({
        maxInputPixels: 1_000_000_000,
        svgToPdf: { engine: 'rsvg-convert', rsvgConvertPath: '', chromePath: 'chrome' },
      }),
      {},
    );

    assert.ok(result.isErr());
    const error: ConversionError = result.error;
    assert.match(
      error.message,
      /Rsvg-convert executable is not configured\. Set graphics-workbench\.execPath\.rsvgConvert\./u,
    );
    assert.ok(!isConversionCancelled(error));
  });

  it('Chrome backendのchromePathが空文字なら、実プロセスを起動せずExternalToolErrorで失敗する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-svg-guard-'));
    const sourcePath = path.join(workspacePath.path, 'source.svg');
    await writeFile(sourcePath, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');

    const result = await convertSinglePdf(
      [
        {
          sourcePath,
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      '${fileDirname}/output.pdf',
      testConversionConfiguration({
        maxInputPixels: 1_000_000_000,
        svgToPdf: { engine: 'chrome', rsvgConvertPath: 'rsvg', chromePath: '   ' },
      }),
      {},
    );

    assert.ok(result.isErr());
    const error: ConversionError = result.error;
    assert.match(error.message, /Chrome executable is not configured\. Set graphics-workbench\.execPath\.chrome\./u);
    assert.ok(!isConversionCancelled(error));
  });

  it('drawioPathが空文字なら、実プロセスを起動せずExternalToolErrorで失敗する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-guard-'));
    const sourcePath = path.join(workspacePath.path, 'source.drawio');
    await writeFile(sourcePath, '<mxfile></mxfile>');

    const result = await convertSinglePdf(
      [
        {
          sourcePath,
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      '${fileDirname}/output.pdf',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000, drawioPath: '   ' }),
      {},
    );

    assert.ok(result.isErr());
    const error: ConversionError = result.error;
    assert.match(error.message, /Draw\.io executable is not configured\. Set graphics-workbench\.execPath\.drawio\./u);
    assert.ok(!isConversionCancelled(error));
  });
});

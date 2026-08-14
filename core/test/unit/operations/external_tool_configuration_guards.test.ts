import assert from 'node:assert/strict';

import { executeDrawio, validateSvgToPdfOptions } from '@graphics-workbench/core/conversion';
import { ExternalToolSpawnError } from '@graphics-workbench/core/external-tools';

describe('外部ツールexecPathの未設定（空文字）ガード', () => {
  it('rsvg-convert backendのrsvgConvertPathが空文字なら、実プロセスを起動せずRsvg-convert executable未設定エラーで失敗する', () => {
    assert.throws(
      () =>
        validateSvgToPdfOptions({
          engine: 'rsvg-convert',
          rsvgConvertPath: '',
          chromePath: 'chrome',
          runRsvgConvert: async () => {
            throw new Error('rsvg must not run');
          },
          runChrome: async () => {
            throw new Error('chrome must not run');
          },
        }),
      /Rsvg-convert executable is not configured\. Set graphics-workbench\.execPath\.rsvgConvert\./u,
    );
  });

  it('Chrome backendのchromePathが空文字なら、実プロセスを起動せずChrome executable未設定エラーで失敗する', () => {
    assert.throws(
      () =>
        validateSvgToPdfOptions({
          engine: 'chrome',
          rsvgConvertPath: 'rsvg',
          chromePath: '   ',
          runRsvgConvert: async () => {
            throw new Error('rsvg must not run');
          },
          runChrome: async () => {
            throw new Error('chrome must not run');
          },
        }),
      /Chrome executable is not configured\. Set graphics-workbench\.execPath\.chrome\./u,
    );
  });

  it('drawioPathが空文字のDraw.io backendでexecuteDrawioを呼ぶと、実プロセスを起動せずDraw.io executable未設定エラーで失敗する', async () => {
    const result = await executeDrawio(
      '  ',
      ['-x', '-f', 'pdf', '-o', 'out.pdf', 'source.drawio'],
      new AbortController().signal,
    );
    assert.ok(result.isErr());
    assert.ok(result.error instanceof ExternalToolSpawnError);
    assert.match(
      result.error.message,
      /Draw\.io executable is not configured\. Set graphics-workbench\.execPath\.drawio\./u,
    );
  });
});

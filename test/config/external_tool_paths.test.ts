import assert from 'node:assert/strict';

import {
  readDrawioExecutablePath,
  readRsvgConvertExecutablePath,
} from '../../src/config/external_tools/external_tool_paths.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('外部ツール実行ファイルパスの設定読み取り', () => {
  test('設定が無い場合はDraw.io実行ファイルパスを空文字として読み取り、rsvg-convertは既定値rsvg-convertとして読み取る', () => {
    const configuration = fakeConfiguration({});

    assert.strictEqual(readDrawioExecutablePath(configuration), '');
    assert.strictEqual(readRsvgConvertExecutablePath(configuration), 'rsvg-convert');
  });

  test('execPath.drawioが空文字で設定されている場合も、その空文字を既定値へ置き換えずそのまま読み取る', () => {
    assert.strictEqual(readDrawioExecutablePath(fakeConfiguration({ 'execPath.drawio': '' })), '');
  });
});

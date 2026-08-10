import assert from 'node:assert/strict';

import {
  readDrawioExecutablePath,
  readRsvgConvertExecutablePath,
} from '../../src/config/external_tools/external_tool_paths.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('外部ツール実行ファイルパスの設定読み取り', () => {
  test('設定が無い場合はDraw.ioとrsvg-convertのmanifest既定commandをそのまま読み取る', () => {
    const configuration = fakeConfiguration({});

    assert.strictEqual(readDrawioExecutablePath(configuration), 'drawio');
    assert.strictEqual(readRsvgConvertExecutablePath(configuration), 'rsvg-convert');
  });

  test('execPath.drawioを明示的に空文字へ変更した場合はfallbackせず空文字をそのまま読み取る', () => {
    assert.strictEqual(readDrawioExecutablePath(fakeConfiguration({ 'execPath.drawio': '' })), '');
  });
});

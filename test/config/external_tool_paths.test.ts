import assert from 'node:assert/strict';

import {
  readDrawioExecutablePath,
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
  readRsvgConvertExecutablePath,
} from '../../src/config/external_tools/external_tool_paths.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('外部tool実行ファイルの設定', () => {
  test('設定値をそのまま読み取る', () => {
    const configuration = fakeConfiguration({ 'execPath.ghostscript': '/custom/gs' });

    assert.strictEqual(readGhostscriptExecutablePath(configuration), '/custom/gs');
    assert.strictEqual(readDrawioExecutablePath(configuration), '');
    assert.strictEqual(readPdftocairoExecutablePath(configuration), 'pdftocairo');
    assert.strictEqual(readRsvgConvertExecutablePath(configuration), 'rsvg-convert');
  });

  test('空文字の設定値をフォールバックせず返す', () => {
    assert.strictEqual(readDrawioExecutablePath(fakeConfiguration({ 'execPath.drawio': '' })), '');
    assert.strictEqual(readGhostscriptExecutablePath(fakeConfiguration({ 'execPath.ghostscript': '' })), '');
  });
});

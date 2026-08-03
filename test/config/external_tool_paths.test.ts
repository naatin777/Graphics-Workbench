import assert from 'node:assert/strict';

import {
  readDrawioExecutablePath,
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
  readRsvgConvertExecutablePath,
  resolveGhostscriptExecutablePath,
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

  test('空文字のGhostscript設定はOS標準の実行ファイル名へフォールバックする', () => {
    assert.strictEqual(readDrawioExecutablePath(fakeConfiguration({ 'execPath.drawio': '' })), '');
    assert.strictEqual(readGhostscriptExecutablePath(fakeConfiguration({ 'execPath.ghostscript': '' })), 'gs');
    assert.strictEqual(resolveGhostscriptExecutablePath('', 'win32'), 'gswin64c');
    assert.strictEqual(resolveGhostscriptExecutablePath('', 'linux'), 'gs');
  });

  test('明示したGhostscriptパスはOSに関係なく優先する', () => {
    assert.strictEqual(resolveGhostscriptExecutablePath('/custom/gs', 'win32'), '/custom/gs');
  });
});

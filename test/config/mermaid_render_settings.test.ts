import assert from 'node:assert/strict';

import { readMermaidCliOptions } from '../../src/config/rendering/mermaid_cli_options.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('MermaidテーマおよびbackgroundColor設定', () => {
  test('デフォルトはtheme=default、backgroundColor=white', () => {
    const options = readMermaidCliOptions(fakeConfiguration());
    assert.strictEqual(options.theme, 'default');
    assert.strictEqual(options.backgroundColor, 'white');
  });

  test('mermaid.themeからカスタムテーマを読み取る', () => {
    const options = readMermaidCliOptions(fakeConfiguration({ 'mermaid.theme': 'dark' }));
    assert.strictEqual(options.theme, 'dark');
  });

  test('mermaid.backgroundColorからカスタムbackgroundColorを読み取る', () => {
    const options = readMermaidCliOptions(fakeConfiguration({ 'mermaid.backgroundColor': 'transparent' }));
    assert.strictEqual(options.backgroundColor, 'transparent');
  });

  test('themeとbackgroundColorはChrome実行パスと共に含まれる', () => {
    const options = readMermaidCliOptions(
      fakeConfiguration({
        'execPath.chrome': '/usr/bin/chrome',
        'mermaid.theme': 'forest',
      }),
    );
    assert.strictEqual(options.theme, 'forest');
    assert.strictEqual(options.backgroundColor, 'white');
    assert.strictEqual(options.chromePath, '/usr/bin/chrome');
  });
});

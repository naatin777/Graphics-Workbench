import assert from 'node:assert/strict';

import { createMermaidBackend } from '../../src/config/rendering/mermaid_cli_options.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('MermaidテーマおよびbackgroundColor設定', () => {
  test("設定を何も与えない場合、themeは'default'・backgroundColorは'white'を返す", () => {
    const options = createMermaidBackend(fakeConfiguration());
    assert.strictEqual(options.theme, 'default');
    assert.strictEqual(options.backgroundColor, 'white');
  });

  test("mermaid.themeに'dark'を設定した場合、themeとして'dark'を読み取る", () => {
    const options = createMermaidBackend(fakeConfiguration({ 'mermaid.theme': 'dark' }));
    assert.strictEqual(options.theme, 'dark');
  });

  test("mermaid.backgroundColorに'transparent'を設定した場合、backgroundColorとして'transparent'を読み取る", () => {
    const options = createMermaidBackend(fakeConfiguration({ 'mermaid.backgroundColor': 'transparent' }));
    assert.strictEqual(options.backgroundColor, 'transparent');
  });

  test("mermaid.theme='forest'・execPath.chrome='/usr/bin/chrome'を設定した場合、theme='forest'・backgroundColor=whiteのまま・chromePath='/usr/bin/chrome'をまとめて返す", () => {
    const options = createMermaidBackend(
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

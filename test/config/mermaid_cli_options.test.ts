import assert from 'node:assert/strict';

import {
  readChromeExecutablePath,
  readMermaidCliOptions,
  resolveChromeExecutablePath,
} from '../../src/config/rendering/mermaid_cli_options.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('Mermaid CLI設定', () => {
  test("execPath.chromeに'/usr/bin/chrome'が設定されている場合は、chromePath='/usr/bin/chrome'・mermaidPath=mmdc・theme=default・backgroundColor=whiteをまとめたMermaid CLIオプションを返す", () => {
    const options = readMermaidCliOptions(
      fakeConfiguration({
        'execPath.chrome': '/usr/bin/chrome',
      }),
    );

    assert.deepEqual(options, {
      chromePath: '/usr/bin/chrome',
      mermaidPath: 'mmdc',
      theme: 'default',
      backgroundColor: 'white',
    });
  });

  test('execPath.chromeが未設定(空文字)の場合は、darwin・win32・linuxそれぞれのOS標準Chrome実行パスへ解決する', () => {
    assert.strictEqual(
      resolveChromeExecutablePath('', 'darwin'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
    assert.strictEqual(resolveChromeExecutablePath('', 'win32'), 'chrome.exe');
    assert.strictEqual(resolveChromeExecutablePath('', 'linux'), 'google-chrome');
  });

  test("readChromeExecutablePathは設定値execPath.chrome'/shared/chrome'をそのまま返す", () => {
    const executablePath = readChromeExecutablePath(
      fakeConfiguration({
        'execPath.chrome': '/shared/chrome',
      }),
    );

    assert.strictEqual(executablePath, '/shared/chrome');
  });
});

import assert from 'node:assert/strict';

import {
  readChromeExecutablePath,
  readMermaidCliOptions,
  resolveChromeExecutablePath,
} from '../../src/config/rendering/mermaid_cli_options.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('Mermaid CLI設定', () => {
  test('execPath.chromeが設定されているとき実行パスを返す', () => {
    const options = readMermaidCliOptions(
      fakeConfiguration({
        'execPath.chrome': '/usr/bin/chrome',
      }),
    );

    assert.deepEqual(options, {
      chromePath: '/usr/bin/chrome',
      theme: 'default',
      backgroundColor: 'white',
    });
  });

  test('未設定時はOS標準のChrome実行パスを使う', () => {
    assert.strictEqual(
      resolveChromeExecutablePath('', 'darwin'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
    assert.strictEqual(resolveChromeExecutablePath('', 'win32'), 'chrome.exe');
    assert.strictEqual(resolveChromeExecutablePath('', 'linux'), 'google-chrome');
  });

  test('readChromeExecutablePathはexecPath.chromeを返す', () => {
    const executablePath = readChromeExecutablePath(
      fakeConfiguration({
        'execPath.chrome': '/shared/chrome',
      }),
    );

    assert.strictEqual(executablePath, '/shared/chrome');
  });
});

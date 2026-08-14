import assert from 'node:assert/strict';

import {
  chromeAutoValue,
  defaultChromeExecutablePath,
  resolveChromeExecutablePath,
} from '../../../../src/config/rendering/chrome_cli_options.js';
import { fakeConfiguration } from '../../../support/helpers/configuration.js';

suite('Chrome executable pathの解決', () => {
  test("未設定（既定値'auto'）はOSごとの既定パスへ解決する", () => {
    const configuration = fakeConfiguration();

    assert.strictEqual(
      resolveChromeExecutablePath(configuration, 'darwin'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
    assert.strictEqual(resolveChromeExecutablePath(configuration, 'win32'), 'chrome.exe');
    assert.strictEqual(resolveChromeExecutablePath(configuration, 'linux'), 'google-chrome');
  });

  test("'auto'を明示してもOSごとの既定パスへ解決する", () => {
    const configuration = fakeConfiguration({ 'execPath.chrome': chromeAutoValue });

    assert.strictEqual(resolveChromeExecutablePath(configuration, 'linux'), 'google-chrome');
  });

  test('明示した絶対パスはそのまま返す', () => {
    const configuration = fakeConfiguration({ 'execPath.chrome': '/opt/chrome/chrome' });

    assert.strictEqual(resolveChromeExecutablePath(configuration, 'linux'), '/opt/chrome/chrome');
  });

  test('空文字は明示的disableとして空のまま返し、notConfigured判定に委ねる', () => {
    const configuration = fakeConfiguration({ 'execPath.chrome': '   ' });

    assert.strictEqual(resolveChromeExecutablePath(configuration, 'linux'), '');
  });

  test('defaultChromeExecutablePathは3 OSの既定パスを返す', () => {
    assert.strictEqual(
      defaultChromeExecutablePath('darwin'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
    assert.strictEqual(defaultChromeExecutablePath('win32'), 'chrome.exe');
    assert.strictEqual(defaultChromeExecutablePath('linux'), 'google-chrome');
  });
});

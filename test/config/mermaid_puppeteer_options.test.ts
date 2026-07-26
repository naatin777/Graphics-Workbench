import assert from 'node:assert/strict';

import {
  readMermaidPuppeteerOptions,
  readPuppeteerExecutablePath,
  type MermaidConfiguration,
} from '../../src/config/rendering/mermaid_puppeteer_options.js';

suite('Mermaid Puppeteer設定', () => {
  test('共通設定が未設定のときレガシー出力別設定を使用する', () => {
    const options = readMermaidPuppeteerOptions(
      fakeConfiguration({
        'convertToSvg.mermaid.puppeteer.browserChannel': 'chrome-beta',
        'convertToSvg.mermaid.puppeteer.executablePath': '/legacy/chrome',
      }),
      'convertToSvg',
    );

    assert.deepEqual(options, {
      browserChannel: 'chrome-beta',
      executablePath: '/legacy/chrome',
      theme: 'default',
      backgroundColor: 'white',
    });
  });

  test('値が意図的にレガシー設定をクリアしても共通設定を使用する', () => {
    const options = readMermaidPuppeteerOptions(
      fakeConfiguration({
        'mermaid.puppeteer.browserChannel': 'chrome-dev',
        'puppeteer.executablePath': '',
        'convertToPdf.mermaid.puppeteer.browserChannel': 'chrome-canary',
        'convertToPdf.mermaid.puppeteer.executablePath': '/legacy/chrome',
      }),
      'convertToPdf',
    );

    assert.deepEqual(options, {
      browserChannel: 'chrome-dev',
      theme: 'default',
      backgroundColor: 'white',
    });
  });

  test('SVG変換と共通の実行パスを共有する', () => {
    const executablePath = readPuppeteerExecutablePath(
      fakeConfiguration({
        'puppeteer.executablePath': '/shared/chrome',
        'convertToPdf.svg.puppeteer.executablePath': '/legacy/chrome',
      }),
      'convertToPdf.svg.puppeteer.executablePath',
    );

    assert.strictEqual(executablePath, '/shared/chrome');
  });
});

function fakeConfiguration(values: Record<string, string>): MermaidConfiguration {
  return {
    get<T>(key: string, defaultValue: T): T {
      return (key in values ? values[key] : defaultValue) as T;
    },
    inspect<T>(key: string) {
      return key in values ? { workspaceValue: values[key] as T } : {};
    },
  };
}

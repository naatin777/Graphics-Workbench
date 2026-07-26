import assert from 'node:assert/strict';

import {
  readMermaidPuppeteerOptions,
  type MermaidConfiguration,
} from '../../src/config/rendering/mermaid_puppeteer_options.js';

suite('MermaidテーマおよびbackgroundColor設定', () => {
  test('デフォルトはtheme=default、backgroundColor=white', () => {
    const options = readMermaidPuppeteerOptions(fakeConfiguration({}), 'convertToPdf');
    assert.strictEqual(options.theme, 'default');
    assert.strictEqual(options.backgroundColor, 'white');
  });

  test('mermaid.themeからカスタムテーマを読み取る', () => {
    const options = readMermaidPuppeteerOptions(fakeConfiguration({ 'mermaid.theme': 'dark' }), 'convertToPdf');
    assert.strictEqual(options.theme, 'dark');
  });

  test('mermaid.backgroundColorからカスタムbackgroundColorを読み取る', () => {
    const options = readMermaidPuppeteerOptions(
      fakeConfiguration({ 'mermaid.backgroundColor': 'transparent' }),
      'convertToPdf',
    );
    assert.strictEqual(options.backgroundColor, 'transparent');
  });

  test('themeとbackgroundColorはexecutablePathと共に含まれる', () => {
    const options = readMermaidPuppeteerOptions(
      fakeConfiguration({
        'puppeteer.executablePath': '/usr/bin/chrome',
        'mermaid.theme': 'forest',
      }),
      'convertToSvg',
    );
    assert.strictEqual(options.theme, 'forest');
    assert.strictEqual(options.backgroundColor, 'white');
    assert.strictEqual(options.executablePath, '/usr/bin/chrome');
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

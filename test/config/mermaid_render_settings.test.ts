import assert from 'node:assert/strict';

import { readMermaidPuppeteerOptions } from '../../src/config/rendering/mermaid_puppeteer_options.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('MermaidテーマおよびbackgroundColor設定', () => {
  test('デフォルトはtheme=default、backgroundColor=white', () => {
    const options = readMermaidPuppeteerOptions(fakeConfiguration());
    assert.strictEqual(options.theme, 'default');
    assert.strictEqual(options.backgroundColor, 'white');
  });

  test('mermaid.themeからカスタムテーマを読み取る', () => {
    const options = readMermaidPuppeteerOptions(fakeConfiguration({ 'mermaid.theme': 'dark' }));
    assert.strictEqual(options.theme, 'dark');
  });

  test('mermaid.backgroundColorからカスタムbackgroundColorを読み取る', () => {
    const options = readMermaidPuppeteerOptions(fakeConfiguration({ 'mermaid.backgroundColor': 'transparent' }));
    assert.strictEqual(options.backgroundColor, 'transparent');
  });

  test('themeとbackgroundColorはexecutablePathと共に含まれる', () => {
    const options = readMermaidPuppeteerOptions(
      fakeConfiguration({
        'puppeteer.executablePath': '/usr/bin/chrome',
        'mermaid.theme': 'forest',
      }),
    );
    assert.strictEqual(options.theme, 'forest');
    assert.strictEqual(options.backgroundColor, 'white');
    assert.strictEqual(options.executablePath, '/usr/bin/chrome');
  });
});

import assert from 'node:assert/strict';

import {
  readMermaidPuppeteerOptions,
  readPuppeteerExecutablePath,
} from '../../src/config/rendering/mermaid_puppeteer_options.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('Mermaid Puppeteer設定', () => {
  test('puppeteer.browserからbrowserChannelを読み取る', () => {
    const options = readMermaidPuppeteerOptions(
      fakeConfiguration({
        'puppeteer.browser': 'firefox',
      }),
    );

    assert.deepEqual(options, {
      browserChannel: 'firefox',
      theme: 'default',
      backgroundColor: 'white',
    });
  });

  test('puppeteer.executablePathが設定されているとき実行パスを返す', () => {
    const options = readMermaidPuppeteerOptions(
      fakeConfiguration({
        'puppeteer.executablePath': '/usr/bin/chrome',
      }),
    );

    assert.deepEqual(options, {
      browserChannel: 'chrome',
      executablePath: '/usr/bin/chrome',
      theme: 'default',
      backgroundColor: 'white',
    });
  });

  test('mermaidのテーマと背景色を読み取る', () => {
    const options = readMermaidPuppeteerOptions(
      fakeConfiguration({
        'mermaid.theme': 'dark',
        'mermaid.backgroundColor': '#000',
      }),
    );

    assert.deepEqual(options, {
      browserChannel: 'chrome',
      theme: 'dark',
      backgroundColor: '#000',
    });
  });

  test('readPuppeteerExecutablePathはpuppeteer.executablePathを返す', () => {
    const executablePath = readPuppeteerExecutablePath(
      fakeConfiguration({
        'puppeteer.executablePath': '/shared/chrome',
      }),
    );

    assert.strictEqual(executablePath, '/shared/chrome');
  });

  test('readPuppeteerExecutablePathは空文字のとき空文字を返す', () => {
    const executablePath = readPuppeteerExecutablePath(fakeConfiguration());

    assert.strictEqual(executablePath, '');
  });
});

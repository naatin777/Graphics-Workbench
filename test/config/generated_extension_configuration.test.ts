import assert from 'node:assert/strict';

import { fakeConfiguration } from '../helpers/configuration.js';

suite('生成された設定スキーマ検証', () => {
  test('列挙値が不正ならデフォルトへフォールバックする', () => {
    const configuration = fakeConfiguration({ 'convertToPdf.svg.engine': 'puppeteer' });

    assert.strictEqual(configuration.convertToPdf.svg.engine(), 'chrome');
  });

  test('数値範囲が不正ならデフォルトへフォールバックする', () => {
    const configuration = fakeConfiguration({ 'convertToWebp.effort': 7 });

    assert.strictEqual(configuration.convertToWebp.effort(), 4);
  });

  test('配列の要素が不正ならデフォルトへフォールバックする', () => {
    const configuration = fakeConfiguration({ 'cropPdf.marginOptions': [0, '5'] });

    assert.deepStrictEqual(configuration.cropPdf.marginOptions(), [0, 5, 10, 20]);
  });

  test('オブジェクトの未定義プロパティはデフォルトへフォールバックする', () => {
    const configuration = fakeConfiguration({ outputPaths: { unknown: 'output.png' } });

    assert.deepStrictEqual(configuration.outputPaths(), {});
  });

  test('大規模入力・性能設定の既定値を提供する', () => {
    const configuration = fakeConfiguration();

    assert.strictEqual(configuration.preview.maxCanvasPixels(), 40_000_000);
    assert.strictEqual(configuration.preview.maxDevicePixelRatio(), 2);
    assert.strictEqual(configuration.performance.maxConcurrentHeavyProcesses(), 2);
    assert.strictEqual(configuration.externalTools.rsvgConvert.timeoutSeconds(), 0);
  });

  test('新しい数値設定の範囲外はデフォルトへフォールバックする', () => {
    const configuration = fakeConfiguration({
      'preview.maxDevicePixelRatio': 0,
      'externalTools.rsvgConvert.timeoutSeconds': 86401,
    });

    assert.strictEqual(configuration.preview.maxDevicePixelRatio(), 2);
    assert.strictEqual(configuration.externalTools.rsvgConvert.timeoutSeconds(), 0);
  });
});

import assert from 'node:assert/strict';

import { fakeConfiguration } from '../helpers/configuration.js';

suite('生成された設定スキーマ検証', () => {
  test('列挙値を厳格に検証する', () => {
    const configuration = fakeConfiguration({ 'puppeteer.browser': 'safari' });

    assert.throws(
      () => configuration.puppeteer.browser(),
      /Invalid configuration value for graphics-workbench\.puppeteer\.browser: expected one of chrome, firefox, received string\./,
    );
  });

  test('数値範囲を厳格に検証する', () => {
    const configuration = fakeConfiguration({ 'convertToWebp.effort': 7 });

    assert.throws(
      () => configuration.convertToWebp.effort(),
      /Invalid configuration value for graphics-workbench\.convertToWebp\.effort: expected integer, received number\./,
    );
  });

  test('配列の要素を厳格に検証する', () => {
    const configuration = fakeConfiguration({ 'cropPdf.marginOptions': [0, '5'] });

    assert.throws(
      () => configuration.cropPdf.marginOptions(),
      /Invalid configuration value for graphics-workbench\.cropPdf\.marginOptions: expected array of number, received array\./,
    );
  });

  test('オブジェクトの未定義プロパティを拒否する', () => {
    const configuration = fakeConfiguration({ outputPaths: { unknown: 'output.png' } });

    assert.throws(
      () => configuration.outputPaths(),
      /Invalid configuration value for graphics-workbench\.outputPaths: expected object, received object\./,
    );
  });

  test('大規模入力・性能設定の既定値を提供する', () => {
    const configuration = fakeConfiguration();

    assert.strictEqual(configuration.preview.maxCanvasPixels(), 40_000_000);
    assert.strictEqual(configuration.preview.maxDevicePixelRatio(), 2);
    assert.strictEqual(configuration.performance.maxConcurrentHeavyProcesses(), 2);
    assert.strictEqual(configuration.externalTools.qpdf.timeoutSeconds(), 0);
  });

  test('新しい数値設定の範囲を拒否する', () => {
    assert.throws(
      () => fakeConfiguration({ 'preview.maxDevicePixelRatio': 0 }).preview.maxDevicePixelRatio(),
      /Invalid configuration value for graphics-workbench\.preview\.maxDevicePixelRatio/iu,
    );
    assert.throws(
      () => fakeConfiguration({ 'externalTools.qpdf.timeoutSeconds': 86401 }).externalTools.qpdf.timeoutSeconds(),
      /Invalid configuration value for graphics-workbench\.externalTools\.qpdf\.timeoutSeconds/iu,
    );
  });
});

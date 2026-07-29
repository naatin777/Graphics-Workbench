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
});

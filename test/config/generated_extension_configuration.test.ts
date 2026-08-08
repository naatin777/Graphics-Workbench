import assert from 'node:assert/strict';

import { fakeConfiguration } from '../helpers/configuration.js';

suite('生成された設定スキーマ検証', () => {
  test("convertToPdf.svg.engineに列挙値でない'puppeteer'を設定した場合、default値'chrome'へフォールバックする", () => {
    const configuration = fakeConfiguration({ 'convertToPdf.svg.engine': 'puppeteer' });

    assert.strictEqual(configuration.convertToPdf.svg.engine(), 'chrome');
  });

  test('convertToWebp.effortに範囲外の7を設定した場合、default値4へフォールバックする', () => {
    const configuration = fakeConfiguration({ 'convertToWebp.effort': 7 });

    assert.strictEqual(configuration.convertToWebp.effort(), 4);
  });

  test("cropPdf.marginOptionsに型が合わない要素'5'を含む[0,'5']を設定した場合、既定の[0,5,10,20]へフォールバックする", () => {
    const configuration = fakeConfiguration({ 'cropPdf.marginOptions': [0, '5'] });

    assert.deepStrictEqual(configuration.cropPdf.marginOptions(), [0, 5, 10, 20]);
  });

  test('outputPathsに未定義プロパティunknownのみを含むオブジェクトを設定した場合、既定の{}へフォールバックする', () => {
    const configuration = fakeConfiguration({ outputPaths: { unknown: 'output.png' } });

    assert.deepStrictEqual(configuration.outputPaths(), {});
  });

  test('設定を何も与えない場合、maxCanvasPixels=40,000,000・maxDevicePixelRatio=2・maxConcurrentHeavyProcesses=2・rsvgConvertタイムアウト0秒の既定値を返す', () => {
    const configuration = fakeConfiguration();

    assert.strictEqual(configuration.preview.maxCanvasPixels(), 40_000_000);
    assert.strictEqual(configuration.preview.maxDevicePixelRatio(), 2);
    assert.strictEqual(configuration.performance.maxConcurrentHeavyProcesses(), 2);
    assert.strictEqual(configuration.externalTools.rsvgConvert.timeoutSeconds(), 0);
  });

  test('preview.maxDevicePixelRatioに範囲外の0、rsvgConvert.timeoutSecondsに範囲外の86,401を設定した場合、それぞれdefaultの2と0へフォールバックする', () => {
    const configuration = fakeConfiguration({
      'preview.maxDevicePixelRatio': 0,
      'externalTools.rsvgConvert.timeoutSeconds': 86401,
    });

    assert.strictEqual(configuration.preview.maxDevicePixelRatio(), 2);
    assert.strictEqual(configuration.externalTools.rsvgConvert.timeoutSeconds(), 0);
  });
});

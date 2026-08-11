import assert from 'node:assert/strict';

import { fakeConfiguration } from '../../support/helpers/configuration.js';

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

  test('設定を何も与えない場合、Draw.io commandと各runtime設定のmanifest既定値を返す', () => {
    const configuration = fakeConfiguration();

    assert.strictEqual(configuration.execPath.drawio(), 'drawio');
    assert.strictEqual(configuration.preview.maxCanvasPixels(), 40_000_000);
    assert.strictEqual(configuration.preview.maxDevicePixelRatio(), 2);
    assert.strictEqual(configuration.performance.maxConcurrentHeavyProcesses(), 2);
    assert.strictEqual(configuration.undoHistory.maxRecords(), 10);
    assert.strictEqual(configuration.externalTools.rsvgConvert.timeoutSeconds(), 0);
  });

  test('execPath.drawioとexecPath.rsvgConvertを明示的に空文字へ変更した場合はfallbackせず空文字をそのまま返す', () => {
    const configuration = fakeConfiguration({ 'execPath.drawio': '', 'execPath.rsvgConvert': '' });

    assert.strictEqual(configuration.execPath.drawio(), '');
    assert.strictEqual(configuration.execPath.rsvgConvert(), '');
  });

  test('outputPath.split.pdfを明示的に空文字へ変更した場合は、invalid configurationとして扱い既定テンプレートへフォールバックしない', () => {
    const configuration = fakeConfiguration({ 'outputPath.split.pdf': '' });

    assert.throws(
      () => configuration.outputPath.split.pdf(),
      /Invalid configuration for graphics-workbench\.outputPath\.split\.pdf/,
    );
  });

  test('outputPath.single.pngを空白文字列や型が合わない数値へ変更した場合は、invalid configurationとして扱い既定テンプレートへフォールバックしない', () => {
    const blank = fakeConfiguration({ 'outputPath.single.png': '   ' });
    assert.throws(() => blank.outputPath.single.png(), /Invalid configuration/);

    const nonString = fakeConfiguration({ 'outputPath.single.png': 123 });
    assert.throws(() => nonString.outputPath.single.png(), /Invalid configuration/);
  });

  test('outputPath.combine.pdfの既定値が${random}を含むworkspaceFolder基準テンプレートである', () => {
    const configuration = fakeConfiguration();

    assert.strictEqual(configuration.outputPath.combine.pdf(), '${workspaceFolder}/combined-${random}.pdf');
  });

  test('outputPath.combine.pdfを空文字へ変更した場合は、invalid configurationとして扱う', () => {
    const configuration = fakeConfiguration({ 'outputPath.combine.pdf': '' });

    assert.throws(() => configuration.outputPath.combine.pdf(), /Invalid configuration/);
  });

  test('undoHistory.maxRecordsに範囲外の0と非整数の1.5を設定した場合、default値10へフォールバックする', () => {
    const outOfBounds = fakeConfiguration({ 'undoHistory.maxRecords': 0 });
    assert.strictEqual(outOfBounds.undoHistory.maxRecords(), 10);

    const nonInteger = fakeConfiguration({ 'undoHistory.maxRecords': 1.5 });
    assert.strictEqual(nonInteger.undoHistory.maxRecords(), 10);
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

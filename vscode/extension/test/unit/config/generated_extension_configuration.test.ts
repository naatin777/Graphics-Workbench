import assert from 'node:assert/strict';

import { fakeConfiguration } from '../../support/helpers/configuration.js';

suite('生成された設定スキーマ検証', () => {
  test("convertToPdf.svg.engineに列挙値でない'puppeteer'を設定した場合、configuration errorになる", () => {
    const configuration = fakeConfiguration({ 'convertToPdf.svg.engine': 'puppeteer' });

    assert.throws(() => configuration.convertToPdf.svg.engine(), /Invalid configuration/);
  });

  test('convertToWebp.effortに範囲外の7を設定した場合、configuration errorになる', () => {
    const configuration = fakeConfiguration({ 'convertToWebp.effort': 7 });

    assert.throws(() => configuration.convertToWebp.effort(), /Invalid configuration/);
  });

  test("cropPdf.marginOptionsに型が合わない要素'5'を含む[0,'5']を設定した場合、configuration errorになる", () => {
    const configuration = fakeConfiguration({ 'cropPdf.marginOptions': [0, '5'] });

    assert.throws(() => configuration.cropPdf.marginOptions(), /Invalid configuration/);
  });

  test('設定を何も与えない場合、各execPathは空文字を返す（未設定＝missing）', () => {
    const configuration = fakeConfiguration();

    assert.strictEqual(configuration.execPath.drawio(), '');
    assert.strictEqual(configuration.execPath.rsvgConvert(), '');
    assert.strictEqual(configuration.execPath.chrome(), '');
    assert.strictEqual(configuration.preview.maxCanvasPixels(), 40_000_000);
    assert.strictEqual(configuration.preview.maxDevicePixelRatio(), 2);
    assert.strictEqual(configuration.performance.maxConcurrentHeavyProcesses(), 2);
    assert.strictEqual(configuration.undoHistory.maxRecords(), 10);
    assert.strictEqual(configuration.externalTools.rsvgConvert.timeoutSeconds(), 0);
  });

  test('execPath.drawio・execPath.rsvgConvert・execPath.chromeを明示的に空文字や空白へ変更した場合はfallbackせず空文字をそのまま返す', () => {
    const configuration = fakeConfiguration({
      'execPath.drawio': '',
      'execPath.rsvgConvert': '   ',
      'execPath.chrome': '',
    });

    assert.strictEqual(configuration.execPath.drawio(), '');
    assert.strictEqual(configuration.execPath.rsvgConvert(), '   ');
    assert.strictEqual(configuration.execPath.chrome(), '');
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

  test('undoHistory.maxRecordsに範囲外の0と非整数の1.5を設定した場合、configuration errorになる', () => {
    const outOfBounds = fakeConfiguration({ 'undoHistory.maxRecords': 0 });
    assert.throws(() => outOfBounds.undoHistory.maxRecords(), /Invalid configuration/);

    const nonInteger = fakeConfiguration({ 'undoHistory.maxRecords': 1.5 });
    assert.throws(() => nonInteger.undoHistory.maxRecords(), /Invalid configuration/);
  });

  test('preview.maxDevicePixelRatioに範囲外の0、rsvgConvert.timeoutSecondsに範囲外の86,401を設定した場合、configuration errorになる', () => {
    const configuration = fakeConfiguration({
      'preview.maxDevicePixelRatio': 0,
      'externalTools.rsvgConvert.timeoutSeconds': 86401,
    });

    assert.throws(() => configuration.preview.maxDevicePixelRatio(), /Invalid configuration/);
    assert.throws(() => configuration.externalTools.rsvgConvert.timeoutSeconds(), /Invalid configuration/);
  });
});

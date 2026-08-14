import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  operationPngInputPath,
  readPdfPages,
  testConversionConfiguration,
  testInputDirectory,
} from '@graphics-workbench/core/testing';
import sharp from 'sharp';

import {
  convertCombinePdf,
  type ConversionConfiguration,
  type ConversionSource,
} from '@graphics-workbench/core/conversion';

const VALID_PNG = operationPngInputPath;

type SupportedInputFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff';

interface SupportedInputTestData {
  format: SupportedInputFormat;
  relativePath: string;
  pageSizes: { width: number; height: number }[];
}

// 期待値はtest/inputの固定testDataItemの実寸をコミットしたもの。テスト実行時の
// sharp解釈（ページ数・サイズ）とproductionの解釈が同時に誤っていてもpass
// しないよう、期待値はここに固定し、metadataはtestDataItemのドリフト検出に使う。
const repeatedPageSizes = (count: number, width: number, height: number): { width: number; height: number }[] =>
  Array.from({ length: count }, () => ({ width, height }));

const supportedInputTestData: SupportedInputTestData[] = [
  { format: 'png', relativePath: 'valid/png/transparent-shapes.png', pageSizes: [{ width: 320, height: 200 }] },
  { format: 'jpeg', relativePath: 'valid/jpeg/color-map.jpeg', pageSizes: [{ width: 384, height: 288 }] },
  { format: 'webp', relativePath: 'valid/webp/heatmap.webp', pageSizes: [{ width: 600, height: 480 }] },
  { format: 'avif', relativePath: 'valid/avif/vortex-vector-field.avif', pageSizes: [{ width: 600, height: 600 }] },
  {
    format: 'gif',
    relativePath: 'valid/gif/rotating-vector-field.gif',
    pageSizes: repeatedPageSizes(30, 240, 240),
  },
  {
    format: 'tiff',
    relativePath: 'valid/tiff/heatmap.tiff',
    pageSizes: [
      { width: 600, height: 480 },
      { width: 200, height: 160 },
      { width: 64, height: 64 },
      { width: 640, height: 160 },
    ],
  },
];

interface InputTestData extends SupportedInputTestData {
  sourcePath: string;
}

async function copyTestDataTo(workspacePath: string, name: string): Promise<string> {
  const destination = path.join(workspacePath, name);
  await copyFile(VALID_PNG, destination);
  return destination;
}

function source(workspacePath: string, sourcePath: string): ConversionSource {
  return {
    sourcePath,
    workspacePath,
    workspaceName: path.basename(workspacePath),
  };
}

function configuration(maxInputPixels: number): ConversionConfiguration {
  return testConversionConfiguration({ maxInputPixels });
}

describe('複数の画像を1つのPDFへ結合する', () => {
  it('単一のPNG画像を読み込んで1ページのPDFを出力する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePath = await copyTestDataTo(workspacePath, 'input.png');
    const outputPath = path.join(workspacePath, 'result.pdf');

    const result = await convertCombinePdf(
      [source(workspacePath, sourcePath)],
      outputPath,
      workspacePath,
      configuration(1_000_000_000),
      {},
    );
    if (result.isErr()) {
      throw result.error;
    }

    const pdfBytes = await readFile(outputPath);
    assert.strictEqual((await readPdfPages(pdfBytes)).length, 1);
  });

  it('設定したラスター入力pixel上限（maxInputPixels）を超えるPNGを渡すと、変換前にpixel上限エラーで拒否してPDFを生成しない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePath = await copyTestDataTo(workspacePath, 'input.png');
    const outputPath = path.join(workspacePath, 'result.pdf');

    const result = await convertCombinePdf(
      [source(workspacePath, sourcePath)],
      outputPath,
      workspacePath,
      configuration(99),
      {},
    );

    assert.ok(result.isErr(), 'pixel limit should reject before conversion');
    assert.match(
      result.error.message,
      /configured raster input pixel limit|pixel limit|Input image exceeds pixel limit/u,
    );
    await assert.rejects(readFile(outputPath));
  });

  it('3つのPNG画像を選択順に読み込み、3ページのPDFを生成し、進捗を1/3・2/3・3/3の順で報告する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePaths = await Promise.all([
      copyTestDataTo(workspacePath, 'a.png'),
      copyTestDataTo(workspacePath, 'b.png'),
      copyTestDataTo(workspacePath, 'c.png'),
    ]);
    const outputPath = path.join(workspacePath, 'result.pdf');
    const progress: [number, number][] = [];

    const result = await convertCombinePdf(
      sourcePaths.map((sourcePath) => source(workspacePath, sourcePath)),
      outputPath,
      workspacePath,
      configuration(1_000_000_000),
      { reportProgress: (completed, total) => progress.push([completed, total]) },
    );
    if (result.isErr()) {
      throw result.error;
    }

    const pdfBytes = await readFile(outputPath);
    assert.strictEqual((await readPdfPages(pdfBytes)).length, 3);
    assert.deepStrictEqual(progress, [
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('2枚のPNGを結合した2ページPDFの各ページが正のwidth/heightを持つことを検証する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePaths = await Promise.all([
      copyTestDataTo(workspacePath, 'a.png'),
      copyTestDataTo(workspacePath, 'b.png'),
    ]);
    const outputPath = path.join(workspacePath, 'result.pdf');

    const result = await convertCombinePdf(
      sourcePaths.map((sourcePath) => source(workspacePath, sourcePath)),
      outputPath,
      workspacePath,
      configuration(1_000_000_000),
      {},
    );
    if (result.isErr()) {
      throw result.error;
    }

    const outputPages = await readPdfPages(await readFile(outputPath));
    assert.strictEqual(outputPages.length, 2);

    for (const page of outputPages) {
      const { width, height } = page.mediaBox;
      assert.ok(width > 0, 'page width should be positive');
      assert.ok(height > 0, 'page height should be positive');
    }
  });

  it('SVGをSVG-to-PDF backend未設定で結合すると「SVG-to-PDF backend is not configured」エラーで拒否し、出力PDFを作成しない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePath = path.join(workspacePath, 'source.svg');
    const outputPath = path.join(workspacePath, 'result.pdf');
    await copyFile(path.join(testInputDirectory, 'valid', 'svg', 'solid-rect-31x19.svg'), sourcePath);

    const result = await convertCombinePdf(
      [source(workspacePath, sourcePath)],
      outputPath,
      workspacePath,
      testConversionConfiguration({
        maxInputPixels: 1_000_000_000,
        svgToPdf: { engine: 'rsvg-convert', rsvgConvertPath: '', chromePath: 'chrome' },
      }),
      {},
    );

    assert.ok(result.isErr(), 'SVG without a configured backend should fail');
    assert.match(
      result.error.message,
      /Rsvg-convert executable is not configured|SVG-to-PDF backend is not configured/u,
    );
    await assert.rejects(readFile(outputPath));
  });

  it('対応する全入力形式（PNG/JPEG/WebP/AVIF/GIF/TIFF）をそれぞれ単独で1PDFへ変換し、各ページサイズを入力の寸法と一致させる', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const testDataItems = await writeSupportedInputTestData(workspacePath);

    for (const testDataItem of testDataItems) {
      const outputPath = path.join(workspacePath, `${testDataItem.format}-result.pdf`);

      const result = await convertCombinePdf(
        [source(workspacePath, testDataItem.sourcePath)],
        outputPath,
        workspacePath,
        configuration(1_000_000_000),
        {},
      );
      if (result.isErr()) {
        throw result.error;
      }

      await assertPdfPageSizes(outputPath, expectedPdfPageSizes([testDataItem]));
    }
  });

  it('全対応形式の混在バッチを入力順に結合し、GIF/TIFFは全フレームを各ページへ展開した上で各ページサイズを保持する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const testDataItems = await writeSupportedInputTestData(workspacePath);
    const outputPath = path.join(workspacePath, 'mixed-result.pdf');

    const result = await convertCombinePdf(
      testDataItems.map((testDataItem) => source(workspacePath, testDataItem.sourcePath)),
      outputPath,
      workspacePath,
      configuration(1_000_000_000),
      {},
    );
    if (result.isErr()) {
      throw result.error;
    }

    await assertPdfPageSizes(outputPath, expectedPdfPageSizes(testDataItems));
  });

  it('画像が0件の場合は「No images」エラーを返す', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const result = await convertCombinePdf(
      [],
      path.join(workspacePath, 'result.pdf'),
      workspacePath,
      configuration(1_000_000_000),
      {},
    );

    assert.ok(result.isErr(), 'empty input batch should fail');
    assert.match(result.error.message, /No images/u);
  });

  it('破損したPNGを渡すと、変換を停止してunsupported image format系エラーを返す', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePath = path.join(workspacePath, 'bad.png');
    await copyFile(path.join(testInputDirectory, 'invalid', 'png', 'truncated.png'), sourcePath);

    const result = await convertCombinePdf(
      [source(workspacePath, sourcePath)],
      path.join(workspacePath, 'result.pdf'),
      workspacePath,
      configuration(1_000_000_000),
      {},
    );

    assert.ok(result.isErr(), 'corrupted PNG should fail');
    assert.match(
      result.error.message,
      /unsupported image format|Input file contains|not a valid|invalid|corrupt header/i,
    );
  });

  it('Draw.io（.drawio.png）・PDF（.pdf）は対象外として変換前に「Unsupported image input:」エラーで拒否する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const rejectionCases = [
      ['diagram.drawio.png', 'valid/drawio/multi-object-diagram.drawio.png'],
      ['document.pdf', 'valid/pdf/single-page-document.pdf'],
    ] as const;

    for (const [fileName, relativePath] of rejectionCases) {
      const sourcePath = path.join(workspacePath, fileName);
      await copyFile(path.join(testInputDirectory, relativePath), sourcePath);

      const result = await convertCombinePdf(
        [source(workspacePath, sourcePath)],
        path.join(workspacePath, `${fileName}.output.pdf`),
        workspacePath,
        configuration(1_000_000_000),
        {},
      );

      assert.ok(result.isErr(), `${fileName} should be rejected`);
      assert.match(result.error.message, /Unsupported image input:/u);
    }
  });
});

async function writeSupportedInputTestData(workspacePath: string): Promise<InputTestData[]> {
  const testDataItems: InputTestData[] = [];

  for (const testDataItem of supportedInputTestData) {
    const sourcePath = path.join(workspacePath, `source-${testDataItem.format}.${testDataItem.format}`);
    await copyFile(path.join(testInputDirectory, testDataItem.relativePath), sourcePath);

    const metadata = await sharp(sourcePath).metadata();
    assert.strictEqual(metadata.pages ?? 1, testDataItem.pageSizes.length, `${testDataItem.format} page count`);
    for (let page = 0; page < testDataItem.pageSizes.length; page += 1) {
      const pageMetadata = await sharp(sourcePath, { page }).metadata();
      assert.deepStrictEqual(
        { width: pageMetadata.width, height: pageMetadata.height },
        testDataItem.pageSizes[page],
        `${testDataItem.format} page ${page} size`,
      );
    }

    testDataItems.push({ ...testDataItem, sourcePath });
  }

  return testDataItems;
}

async function assertPdfPageSizes(
  pdfPath: string,
  expectedPageSizes: { width: number; height: number }[],
): Promise<void> {
  const pages = await readPdfPages(await readFile(pdfPath));
  assert.strictEqual(pages.length, expectedPageSizes.length);

  for (const [index, expected] of expectedPageSizes.entries()) {
    const page = pages[index];
    assert.deepStrictEqual(
      { width: page?.mediaBox.width, height: page?.mediaBox.height },
      { width: expected.width, height: expected.height },
    );
  }
}

function expectedPdfPageSizes(testDataItems: InputTestData[]): { width: number; height: number }[] {
  return testDataItems.flatMap((testDataItem) => testDataItem.pageSizes);
}

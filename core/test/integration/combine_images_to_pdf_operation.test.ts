import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  operationPngInputPath,
  createPdfFixture,
  readPdfPages,
  testInputDirectory,
} from '@graphics-workbench/core/testing';
import sharp from 'sharp';
import { combineImagesToPdf, type SvgToPdfBackend } from '@graphics-workbench/core/conversion';

const VALID_PNG = operationPngInputPath;

const supportedInputFixtures = [
  { format: 'png', relativePath: 'valid/png/transparent-shapes.png' },
  { format: 'jpeg', relativePath: 'valid/jpeg/color-map.jpeg' },
  { format: 'webp', relativePath: 'valid/webp/heatmap.webp' },
  { format: 'avif', relativePath: 'valid/avif/vortex-vector-field.avif' },
  { format: 'gif', relativePath: 'valid/gif/rotating-vector-field.gif' },
  { format: 'tiff', relativePath: 'valid/tiff/heatmap.tiff' },
  { format: 'svg', relativePath: 'valid/svg/solid-rect-31x19.svg' },
] as const;

type SupportedInputFormat = (typeof supportedInputFixtures)[number]['format'];

interface InputFixture {
  format: SupportedInputFormat;
  sourcePath: string;
  pageSizes: { width: number; height: number }[];
}

async function copyFixtureTo(workspacePath: string, name: string): Promise<string> {
  const destination = path.join(workspacePath, name);
  await copyFile(VALID_PNG, destination);
  return destination;
}

describe('複数の画像を1つのPDFへ結合する', () => {
  it('単一のPNG画像を読み込んで1ページのPDFを出力する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePath = await copyFixtureTo(workspacePath, 'input.png');
    const outputPath = path.join(workspacePath, 'result.pdf');

    await combineImagesToPdf({
      inputs: [{ sourcePath }],
      outputPath,
      workspacePath,
      runtime: {},
      maxInputPixels: 1_000_000_000,
    });

    const pdfBytes = await readFile(outputPath);
    assert.strictEqual((await readPdfPages(pdfBytes)).length, 1);
  });

  it('設定したラスター入力pixel上限（maxInputPixels）を超えるPNGを渡すと、変換前にpixel上限エラーで拒否してPDFを生成しない', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePath = await copyFixtureTo(workspacePath, 'input.png');
    const outputPath = path.join(workspacePath, 'result.pdf');

    await assert.rejects(
      combineImagesToPdf({
        inputs: [{ sourcePath }],
        outputPath,
        workspacePath,
        runtime: {},
        maxInputPixels: 99,
      }),
      /configured raster input pixel limit|pixel limit|Input image exceeds pixel limit/u,
    );
  });

  it('3つのPNG画像を選択順に読み込み、3ページのPDFを生成し、進捗を1/3・2/3・3/3の順で報告する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePaths = await Promise.all([
      copyFixtureTo(workspacePath, 'a.png'),
      copyFixtureTo(workspacePath, 'b.png'),
      copyFixtureTo(workspacePath, 'c.png'),
    ]);
    const outputPath = path.join(workspacePath, 'result.pdf');
    const progress: [number, number][] = [];

    await combineImagesToPdf({
      inputs: sourcePaths.map((sourcePath) => ({ sourcePath })),
      outputPath,
      workspacePath,
      maxInputPixels: 1_000_000_000,
      runtime: { reportProgress: (completed, total) => progress.push([completed, total]) },
    });

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
      copyFixtureTo(workspacePath, 'a.png'),
      copyFixtureTo(workspacePath, 'b.png'),
    ]);
    const outputPath = path.join(workspacePath, 'result.pdf');

    await combineImagesToPdf({
      inputs: sourcePaths.map((sourcePath) => ({ sourcePath })),
      outputPath,
      workspacePath,
      runtime: {},
      maxInputPixels: 1_000_000_000,
    });

    const outputPages = await readPdfPages(await readFile(outputPath));
    assert.strictEqual(outputPages.length, 2);

    for (const page of outputPages) {
      const { width, height } = page.mediaBox;
      assert.ok(width > 0, 'page width should be positive');
      assert.ok(height > 0, 'page height should be positive');
    }
  });

  it('SVGを設定したrsvg-convertへ--format=pdf --outputで渡し、SVGのpixel寸法（31x19）をそのままpointとして正規化したページを出力する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePath = path.join(workspacePath, 'source.svg');
    const outputPath = path.join(workspacePath, 'result.pdf');
    await copyFile(path.join(testInputDirectory, 'valid', 'svg', 'solid-rect-31x19.svg'), sourcePath);

    const sourcePdfBytes = await createPdfFixture({ pages: [{ mediaBox: [0, 0, 7, 11] }] });
    const calls: string[][] = [];
    const svgToPdfTools: SvgToPdfBackend = {
      engine: 'rsvg-convert',
      rsvgConvertPath: 'configured-rsvg-convert',
      chromePath: '',
      runRsvgConvert: async (executable, args) => {
        calls.push([executable, ...args]);
        const outputArgumentIndex = args.indexOf('--output') + 1;
        const stagedPath = args[outputArgumentIndex];
        assert.ok(stagedPath);
        await writeFile(stagedPath, sourcePdfBytes);
      },
      runChrome: async () => {
        throw new Error('chrome must not run for rsvg-convert engine');
      },
    };

    await combineImagesToPdf({
      inputs: [{ sourcePath }],
      outputPath,
      workspacePath,
      runtime: {},
      maxInputPixels: 1_000_000_000,
      tools: { svgToPdfTools },
      platform: 'linux',
    });

    const outputPages = await readPdfPages(await readFile(outputPath));
    assert.deepStrictEqual(
      { width: outputPages[0]?.mediaBox.width, height: outputPages[0]?.mediaBox.height },
      { width: 31, height: 19 },
    );
    assert.deepStrictEqual(calls[0]?.slice(0, 3), ['configured-rsvg-convert', '--format=pdf', '--output']);
  });

  it('対応する全入力形式（PNG/JPEG/WebP/AVIF/GIF/TIFF/SVG）をそれぞれ単独で1PDFへ変換し、各ページサイズを入力の寸法と一致させる', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const fixtures = await writeSupportedInputFixtures(workspacePath);

    for (const fixture of fixtures) {
      const outputPath = path.join(workspacePath, `${fixture.format}-result.pdf`);

      await combineImagesToPdf({
        inputs: [{ sourcePath: fixture.sourcePath }],
        outputPath,
        workspacePath,
        runtime: {},
        maxInputPixels: 1_000_000_000,
        tools: {
          svgToPdfTools: createStubSvgToPdfOptions(),
        },
        platform: process.platform,
      });

      await assertPdfPageSizes(outputPath, expectedPdfPageSizes([fixture]));
    }
  });

  it('全対応形式の混在バッチを入力順に結合し、GIF/TIFFは全フレームを各ページへ展開した上で各ページサイズを保持する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const fixtures = await writeSupportedInputFixtures(workspacePath);
    const outputPath = path.join(workspacePath, 'mixed-result.pdf');

    await combineImagesToPdf({
      inputs: fixtures.map((fixture) => ({ sourcePath: fixture.sourcePath })),
      outputPath,
      workspacePath,
      runtime: {},
      maxInputPixels: 1_000_000_000,
      tools: {
        svgToPdfTools: createStubSvgToPdfOptions(),
      },
      platform: process.platform,
    });

    await assertPdfPageSizes(outputPath, expectedPdfPageSizes(fixtures));
  });

  it('画像が0件の場合は「No images」エラーを返す', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    await assert.rejects(
      combineImagesToPdf({
        inputs: [],
        outputPath: path.join(workspacePath, 'result.pdf'),
        workspacePath,
        runtime: {},
        maxInputPixels: 1_000_000_000,
      }),
      /No images/,
    );
  });

  it('破損したPNGを渡すと、変換を停止してunsupported image format系エラーを返す', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-combine-'));
    const workspacePath = workspacePathDisposable.path;

    const sourcePath = path.join(workspacePath, 'bad.png');
    await copyFile(path.join(testInputDirectory, 'invalid', 'png', 'truncated.png'), sourcePath);

    await assert.rejects(
      combineImagesToPdf({
        inputs: [{ sourcePath }],
        outputPath: path.join(workspacePath, 'result.pdf'),
        workspacePath,
        runtime: {},
        maxInputPixels: 1_000_000_000,
      }),
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

      await assert.rejects(
        combineImagesToPdf({
          inputs: [{ sourcePath }],
          outputPath: path.join(workspacePath, `${fileName}.output.pdf`),
          workspacePath,
          runtime: {},
          maxInputPixels: 1_000_000_000,
        }),
        /Unsupported image input:/,
      );
    }
  });
});

async function writeSupportedInputFixtures(workspacePath: string): Promise<InputFixture[]> {
  const fixtures: InputFixture[] = [];

  for (const fixture of supportedInputFixtures) {
    const sourcePath = path.join(workspacePath, `source-${fixture.format}.${fixture.format}`);
    await copyFile(path.join(testInputDirectory, fixture.relativePath), sourcePath);

    const metadata = await sharp(sourcePath).metadata();
    assert.ok(metadata.width !== undefined && metadata.height !== undefined, `${fixture.format} metadata size`);
    const pageSizes: { width: number; height: number }[] = [];
    for (let page = 0; page < (metadata.pages ?? 1); page += 1) {
      const pageMetadata = await sharp(sourcePath, { page }).metadata();
      assert.ok(pageMetadata.width !== undefined && pageMetadata.height !== undefined, `${fixture.format} page size`);
      pageSizes.push({ width: pageMetadata.width, height: pageMetadata.height });
    }

    fixtures.push({ ...fixture, sourcePath, pageSizes });
  }

  return fixtures;
}

function createStubSvgToPdfOptions(): SvgToPdfBackend {
  return {
    engine: 'rsvg-convert',
    rsvgConvertPath: 'configured-rsvg-convert',
    chromePath: '',
    runRsvgConvert: async (_executable, args) => {
      const outputArgumentIndex = args.indexOf('--output') + 1;
      const outputPath = args[outputArgumentIndex];
      assert.ok(outputPath);

      const sourcePdfBytes = await createPdfFixture({ pages: [{ mediaBox: [0, 0, 1, 1] }] });
      await writeFile(outputPath, sourcePdfBytes);
    },
    runChrome: async () => {
      throw new Error('chrome must not run for rsvg-convert engine');
    },
  };
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

function expectedPdfPageSizes(fixtures: InputFixture[]): { width: number; height: number }[] {
  return fixtures.flatMap((fixture) => fixture.pageSizes);
}

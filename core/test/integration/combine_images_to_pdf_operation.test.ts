import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { operationPngInputPath, createPdfFixture, readPdfPages } from '@graphics-workbench/core/testing';
import sharp from 'sharp';
import { combineImagesToPdf, type SvgToPdfBackend } from '@graphics-workbench/core/conversion';

const VALID_PNG = operationPngInputPath;

const supportedInputFixtures = [
  { format: 'png', width: 320, height: 200 },
  { format: 'jpeg', width: 11, height: 7 },
  { format: 'webp', width: 13, height: 9 },
  { format: 'avif', width: 17, height: 11 },
  { format: 'gif', width: 19, height: 13 },
  { format: 'tiff', width: 23, height: 15 },
  { format: 'svg', width: 29, height: 17 },
] as const;

type SupportedInputFormat = (typeof supportedInputFixtures)[number]['format'];

interface InputFixture {
  format: SupportedInputFormat;
  sourcePath: string;
  width: number;
  height: number;
}

async function setupWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'gw-combine-'));
}

async function copyFixtureTo(workspacePath: string, name: string): Promise<string> {
  const destination = path.join(workspacePath, name);
  await copyFile(VALID_PNG, destination);
  return destination;
}

describe('複数の画像を1つのPDFへ結合する', () => {
  it('単一のPNG画像を読み込んで1ページのPDFを出力する', async () => {
    const workspacePath = await setupWorkspace();

    try {
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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('設定したラスター入力pixel上限（maxInputPixels）を超えるPNGを渡すと、変換前にpixel上限エラーで拒否してPDFを生成しない', async () => {
    const workspacePath = await setupWorkspace();

    try {
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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('3つのPNG画像を選択順に読み込み、3ページのPDFを生成し、進捗を1/3・2/3・3/3の順で報告する', async () => {
    const workspacePath = await setupWorkspace();

    try {
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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('2枚のPNGを結合した2ページPDFの各ページが正のwidth/heightを持つことを検証する', async () => {
    const workspacePath = await setupWorkspace();

    try {
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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('SVGを設定したrsvg-convertへ--format=pdf --outputで渡し、SVGのpixel寸法（31x19）をそのままpointとして正規化したページを出力する', async () => {
    const workspacePath = await setupWorkspace();

    try {
      const sourcePath = path.join(workspacePath, 'source.svg');
      const outputPath = path.join(workspacePath, 'result.pdf');
      await writeFile(
        sourcePath,
        '<svg xmlns="http://www.w3.org/2000/svg" width="31" height="19" viewBox="0 0 31 19"><rect width="31" height="19" /></svg>',
      );

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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('対応する全入力形式（PNG/JPEG/WebP/AVIF/GIF/TIFF/SVG）をそれぞれ単独で1PDFへ変換し、各ページサイズを入力の寸法と一致させる', async () => {
    const workspacePath = await setupWorkspace();

    try {
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

        await assertPdfPageSizes(outputPath, expectedPdfFixtures([fixture]));
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('全対応形式の混在バッチを入力順に結合し、GIF/TIFFは2フレームを各2ページへ展開した上で各ページサイズを保持する', async () => {
    const workspacePath = await setupWorkspace();

    try {
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

      await assertPdfPageSizes(outputPath, expectedPdfFixtures(fixtures));
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('画像が0件の場合は「No images」エラーを返す', async () => {
    const workspacePath = await setupWorkspace();

    try {
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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('破損したPNGを渡すと、変換を停止してunsupported image format系エラーを返す', async () => {
    const workspacePath = await setupWorkspace();

    try {
      const sourcePath = path.join(workspacePath, 'bad.png');
      await writeFile(sourcePath, 'not a png');

      await assert.rejects(
        combineImagesToPdf({
          inputs: [{ sourcePath }],
          outputPath: path.join(workspacePath, 'result.pdf'),
          workspacePath,
          runtime: {},
          maxInputPixels: 1_000_000_000,
        }),
        /unsupported image format|Input file contains|not a valid|invalid/i,
      );
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('Draw.io（.drawio.png）・PDF（.pdf）は対象外として変換前に「Unsupported image input:」エラーで拒否する', async () => {
    const workspacePath = await setupWorkspace();

    try {
      for (const fileName of ['diagram.drawio.png', 'document.pdf']) {
        const sourcePath = path.join(workspacePath, fileName);
        await writeFile(sourcePath, 'unsupported');

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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

async function writeSupportedInputFixtures(workspacePath: string): Promise<InputFixture[]> {
  const fixtures: InputFixture[] = [];

  for (const fixture of supportedInputFixtures) {
    const sourcePath = path.join(workspacePath, `source-${fixture.format}.${fixture.format}`);

    if (fixture.format === 'png') {
      await copyFile(VALID_PNG, sourcePath);
    } else if (fixture.format === 'jpeg' || fixture.format === 'webp' || fixture.format === 'avif') {
      await writeRasterFixture(sourcePath, fixture.format, fixture.width, fixture.height);
    } else if (fixture.format === 'gif' || fixture.format === 'tiff') {
      await writeAnimatedImageFixture(sourcePath, fixture.format, fixture.width, fixture.height);
    } else if (fixture.format === 'svg') {
      await writeFile(
        sourcePath,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${fixture.width}" height="${fixture.height}" viewBox="0 0 ${fixture.width} ${fixture.height}"><rect width="${fixture.width}" height="${fixture.height}" /></svg>`,
      );
    }

    fixtures.push({ ...fixture, sourcePath });
  }

  return fixtures;
}

async function writeRasterFixture(
  filePath: string,
  format: 'jpeg' | 'webp' | 'avif',
  width: number,
  height: number,
): Promise<void> {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  });

  if (format === 'jpeg') {
    await image.jpeg().toFile(filePath);
  } else if (format === 'webp') {
    await image.webp().toFile(filePath);
  } else {
    await image.avif().toFile(filePath);
  }
}

async function writeAnimatedImageFixture(
  filePath: string,
  format: 'gif' | 'tiff',
  width: number,
  height: number,
): Promise<void> {
  const red = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const blue = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const output = sharp([red, blue], { join: { animated: true } });
  await (format === 'gif' ? output.gif() : output.tiff()).toFile(filePath);
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

async function assertPdfPageSizes(pdfPath: string, fixtures: InputFixture[]): Promise<void> {
  const pages = await readPdfPages(await readFile(pdfPath));
  assert.strictEqual(pages.length, fixtures.length);

  for (const [index, fixture] of fixtures.entries()) {
    const page = pages[index];
    assert.deepStrictEqual(
      { width: page?.mediaBox.width, height: page?.mediaBox.height },
      { width: fixture.width, height: fixture.height },
    );
  }
}

function expectedPdfFixtures(fixtures: InputFixture[]): InputFixture[] {
  return fixtures.flatMap((fixture) =>
    fixture.format === 'gif' || fixture.format === 'tiff' ? [fixture, fixture] : [fixture],
  );
}

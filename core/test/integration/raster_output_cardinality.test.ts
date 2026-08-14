import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { requireValue, readPdfPages } from '@graphics-workbench/core/testing';
import sharp from 'sharp';

import {
  convertToPdfFiles,
  executeDrawio,
  executeRasterConversion,
  rasterFormatSpecs,
} from '@graphics-workbench/core/conversion';

const inputFormats = ['gif', 'tiff'] as const;
const outputFormats = ['pdf', 'png', 'jpeg', 'webp', 'avif', 'gif', 'tiff'] as const;

function stubRunPdfToPng(): never {
  throw new Error('PDF to PNG rendering must not run in this test.');
}
describe('GIF/TIFFを各出力形式へ変換する', () => {
  it('2フレームのGIF/TIFFをPDFへ変換すると全フレームを2ページへ展開し、他のラスター出力へは先頭フレームだけを4x4の赤画像として出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-additional-image-output-'));

    for (const inputFormat of inputFormats) {
      const sourcePath = path.join(workspacePath.path, `source.${inputFormat}`);
      await writeAnimatedImageTestData(sourcePath, inputFormat);

      for (const outputFormat of outputFormats) {
        if (outputFormat === inputFormat) {
          continue;
        }
        const outputPath = path.join(workspacePath.path, `source-${inputFormat}.${outputFormat}`);
        await convertImage(inputFormat, outputFormat, sourcePath, outputPath, workspacePath.path);
        await assertOutput(inputFormat, outputFormat, outputPath);
      }
    }
  });
});

async function convertImage(
  inputFormat: (typeof inputFormats)[number],
  outputFormat: (typeof outputFormats)[number],
  sourcePath: string,
  outputPath: string,
  workspacePath: string,
): Promise<void> {
  const item = { sourcePath, outputPath, workspacePath };
  const runtime = { resolveConflicts: async (): Promise<'overwrite'> => 'overwrite' };

  if (outputFormat === 'pdf') {
    await convertToPdfFiles({
      inputs: [item],
      runtime,
      maxInputPixels: 100_000_000,
    });
    return;
  }

  const common = {
    inputs: [item],
    pdfRenderTools: { runPdfToPng: stubRunPdfToPng },
    drawioTools: { drawioPath: 'drawio', runDrawio: executeDrawio },
    runtime,
    maxInputPixels: 100_000_000,
    runId: `${inputFormat}-${outputFormat}`,
  };

  await executeRasterConversion({
    ...common,
    spec: rasterFormatSpecs[outputFormat],
    ...((outputFormat === 'webp' || outputFormat === 'avif') && { outputOptions: { effort: 0 } }),
  });
}

async function writeAnimatedImageTestData(filePath: string, format: (typeof inputFormats)[number]): Promise<void> {
  const red = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const blue = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const output = sharp([red, blue], { join: { animated: true } });
  await (format === 'gif' ? output.gif() : output.tiff()).toFile(filePath);
}

async function assertOutput(
  inputFormat: (typeof inputFormats)[number],
  outputFormat: (typeof outputFormats)[number],
  filePath: string,
): Promise<void> {
  if (outputFormat === 'pdf') {
    // アニメーションの全フレームが1つのPDFの各ページへ展開される。
    const pages = await readPdfPages(await readFile(filePath));
    assert.strictEqual(pages.length, 2);
    for (const page of pages) {
      assert.strictEqual(page.mediaBox.width, 4);
      assert.strictEqual(page.mediaBox.height, 4);
    }
    return;
  }

  const buffer = await readFile(filePath);
  const metadata = await sharp(buffer).metadata();
  // sharpのmetadataはAVIFを'heif'として報告する。
  assert.strictEqual(metadata.format, outputFormat === 'avif' ? 'heif' : outputFormat);
  // GIF/TIFFを静止ラスター出力へ変換した場合、先頭フレームだけを1ページに保つ。
  assert.strictEqual(metadata.pages ?? 1, 1, `input ${inputFormat} must keep only the first frame for ${outputFormat}`);
  assert.strictEqual(metadata.width, 4);
  assert.strictEqual(metadata.height, 4);

  const { data } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    assert.ok(requireValue(data[index]) > 220);
    assert.ok(requireValue(data[index + 1]) < 30);
    assert.ok(requireValue(data[index + 2]) < 30);
  }
}

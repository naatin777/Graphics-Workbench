import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

import { convertToPdfFiles } from '../../src/operations/conversion/convert_to_pdf.js';
import {
  executeAvifConversion,
  executeJpegConversion,
  executePngConversion,
  executeWebpConversion,
} from '../../src/operations/conversion/raster_conversion.js';
import { requireValue } from '../helpers/required.js';

const inputFormats = ['gif', 'tiff'] as const;
const outputFormats = ['pdf', 'png', 'jpeg', 'webp', 'avif'] as const;

suite('GIF/TIFFを各出力形式へ変換する', () => {
  test('2フレームのGIF/TIFFをPDFへ変換すると全フレームを2ページへ展開し、PNG/JPEG/WebP/AVIFへ変換すると先頭フレームだけを4x4の赤画像として出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-additional-image-output-'));

    for (const inputFormat of inputFormats) {
      const sourcePath = path.join(workspacePath.path, `source.${inputFormat}`);
      await writeAnimatedImageFixture(sourcePath, inputFormat);

      for (const outputFormat of outputFormats) {
        const outputPath = path.join(workspacePath.path, `source-${inputFormat}.${outputFormat}`);
        await convertImage(inputFormat, outputFormat, sourcePath, outputPath, workspacePath.path);
        // PDFは全フレームを1つのPDFの各ページへ展開する。それ以外のラスター出力は
        // 先頭frame/pageのみを保持する。
        await assertOutput(outputFormat, outputPath);
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
  const job = { sourcePath, outputPath, workspacePath };
  const runtime = { resolveConflicts: async (): Promise<'overwrite'> => 'overwrite' };

  if (outputFormat === 'pdf') {
    await convertToPdfFiles({
      jobs: [job],
      supportedExtensions: [`.${inputFormat}`],
      operationName: 'convert-additional-image-to-pdf',
    });
    return;
  }

  const common = {
    jobs: [job],
    pdfRenderTools: {},
    mermaidTools: { chromePath: 'chrome', mermaidPath: 'mmdc', theme: 'default', backgroundColor: 'white' },
    drawioTools: { drawioPath: 'drawio' },
    runtime,
    runId: `${inputFormat}-${outputFormat}`,
  };

  if (outputFormat === 'png') {
    await executePngConversion(common);
  } else if (outputFormat === 'jpeg') {
    await executeJpegConversion(common);
  } else if (outputFormat === 'webp') {
    await executeWebpConversion({ ...common, webp: { effort: 0 } });
  } else {
    await executeAvifConversion({ ...common, avif: { effort: 0 } });
  }
}

async function writeAnimatedImageFixture(filePath: string, format: (typeof inputFormats)[number]): Promise<void> {
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

async function assertOutput(outputFormat: (typeof outputFormats)[number], filePath: string): Promise<void> {
  if (outputFormat === 'pdf') {
    // アニメーションの全フレームが1つのPDFの各ページへ展開される。
    const document = await PDFDocument.load(await readFile(filePath));
    assert.strictEqual(document.getPageCount(), 2);
    for (const page of document.getPages()) {
      assert.strictEqual(page.getWidth(), 4);
      assert.strictEqual(page.getHeight(), 4);
    }
    return;
  }

  const buffer = await readFile(filePath);
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.strictEqual(info.width, 4);
  assert.strictEqual(info.height, 4);
  assert.strictEqual(info.format, 'raw');

  for (let index = 0; index < data.length; index += 4) {
    assert.ok(requireValue(data[index]) > 220);
    assert.ok(requireValue(data[index + 1]) < 30);
    assert.ok(requireValue(data[index + 2]) < 30);
  }
}

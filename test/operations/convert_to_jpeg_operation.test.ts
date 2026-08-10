// Test target:
// - editable Draw.io画像をJPEGへ変換するとき、Draw.io CLIへPDF出力を要求しPNG中間を経てJPEGへ変換すること
// - 最終出力が読み取り可能なJPEGとして反映されること

import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from '../helpers/pdf_document.js';
import sharp from 'sharp';

import {
  executeRasterConversion,
  rasterFormatSpecs,
  type RasterInput,
} from '../../src/operations/conversion/raster_conversion.js';
import type { DrawioBackend } from '../../src/operations/conversion/tools/drawio_tools.js';
import { requireValue } from '../helpers/required.js';

suite('編集可能なDraw.io画像をPDF中間経由でJPEGへ変換する処理', () => {
  test('編集可能なDraw.io画像をDraw.io CLIへ-f pdfオプションでPDF出力を要求し、そのPDFを1ページ目PNGへ描画してから読み取り可能なJPEGを最終出力へ反映する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-jpeg-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'source.jpeg');
    await writeFile(sourcePath, 'editable drawio image placeholder');
    const drawioCalls: string[][] = [];
    const drawio: DrawioBackend = {
      drawioPath: 'drawio',
      runDrawio: async (_executable, args) => {
        drawioCalls.push(args);
        const outputFlagIndex = args.indexOf('-o');
        assert.ok(outputFlagIndex >= 0);
        const pdfPath = args[outputFlagIndex + 1];
        assert.ok(pdfPath);
        const document = await PDFDocument.create();
        document.addPage([32, 24]);
        await writeFile(pdfPath, await document.save());
      },
    };
    const job: RasterInput = {
      sourcePath,
      outputPath,
      workspacePath: workspacePath.path,
      page: 1,
    };

    await executeRasterConversion({
      spec: rasterFormatSpecs.jpeg,
      maxInputPixels: 1_000_000_000,
      inputs: [job],
      pdfRenderTools: {
        runPdfToPng: async (pdfPath, pngPath, page) => {
          assert.ok(pdfPath.endsWith('.pdf'));
          assert.strictEqual(page, 1);
          await sharp({
            create: {
              width: 32,
              height: 24,
              channels: 4,
              background: '#285078',
            },
          })
            .png()
            .toFile(pngPath);
        },
      },
      mermaidTools: { chromePath: 'chrome', mermaidPath: 'mmdc', theme: 'default', backgroundColor: 'white' },
      drawioTools: drawio,
      runtime: { resolveConflicts: async () => 'overwrite' },
    });

    assert.strictEqual(drawioCalls.length, 1);
    const args = requireValue(drawioCalls[0]);
    assert.strictEqual(args[0], '-x');
    assert.strictEqual(args[1], '-f');
    assert.strictEqual(args[2], 'pdf');
    assert.strictEqual(args[3], '-o');
    assert.ok(args[4]?.endsWith('.pdf'));
    assert.strictEqual(args[5], sourcePath);
    await assertReadableJpeg(outputPath);
  });
});

async function assertReadableJpeg(filePath: string): Promise<void> {
  const buffer = await readFile(filePath);
  const metadata = await sharp(buffer).metadata();

  assert.strictEqual(metadata.format, 'jpeg');
  assert.ok(metadata.width);
  assert.ok(metadata.width > 0);
  assert.ok(metadata.height);
  assert.ok(metadata.height > 0);
}

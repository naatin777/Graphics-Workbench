// Test target:
// - editable Draw.io画像をPNGへ変換するとき、Draw.io CLIへPNG出力を要求せずPDFを経由すること
// - Draw.io runnerを注入しても、最終出力は読み取り可能なPNGとして反映されること

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
} from '@graphics-workbench/core/operations/conversion/raster_conversion.js';
import {
  executeDrawio,
  type DrawioBackend,
} from '@graphics-workbench/core/operations/conversion/tools/drawio_tools.js';
import { requireValue } from '../helpers/required.js';

function stubRunPdfToPng(): never {
  throw new Error('PDF to PNG rendering must not run in this test.');
}
suite('アニメーション画像とDraw.io画像をPNGへ変換する処理', () => {
  test('GIF・アニメーションWebP・TIFFの2フレームをフレームごとの個別PNGへ変換し、1フレーム目は赤系・2フレーム目は青系の内容のPNGを生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-png-frames-'));

    for (const format of ['gif', 'webp', 'tiff'] as const) {
      const sourcePath = path.join(workspacePath.path, `source.${format}`);
      await writeAnimatedRaster(sourcePath, format);
      await executeRasterConversion({
        spec: rasterFormatSpecs.png,
        maxInputPixels: 1_000_000_000,
        inputs: [1, 2].map((page) => ({
          sourcePath,
          outputPath: path.join(workspacePath.path, `${format}-${page}.png`),
          workspacePath: workspacePath.path,
          page,
        })),
        pdfRenderTools: { runPdfToPng: stubRunPdfToPng },
        mermaidTools: { chromePath: 'chrome', mermaidPath: 'mmdc', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio', runDrawio: executeDrawio },
        runtime: { resolveConflicts: async () => 'overwrite' },
      });

      assert.ok(
        requireValue(
          (await sharp(await readFile(path.join(workspacePath.path, `${format}-1.png`))).stats()).channels[0],
        ).mean > 200,
      );
      assert.ok(
        requireValue(
          (await sharp(await readFile(path.join(workspacePath.path, `${format}-2.png`))).stats()).channels[2],
        ).mean > 200,
      );
    }
  });

  test('編集可能なDraw.io画像をDraw.io CLIへ-f pdfオプションでPDF出力を要求し、そのPDFを1ページ目PNGへ描画してから読み取り可能なPNGを最終出力へ反映する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-png-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'source.png');
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
      spec: rasterFormatSpecs.png,
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
    await assertReadablePng(outputPath);
  });
});

async function writeAnimatedRaster(filePath: string, format: 'gif' | 'webp' | 'tiff'): Promise<void> {
  const red = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ff0000' } })
    .png()
    .toBuffer();
  const blue = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#0000ff' } })
    .png()
    .toBuffer();
  const output = sharp([red, blue], { join: { animated: true } });
  await (format === 'gif' ? output.gif() : format === 'webp' ? output.webp() : output.tiff()).toFile(filePath);
}

async function assertReadablePng(filePath: string): Promise<void> {
  const buffer = await readFile(filePath);
  const metadata = await sharp(buffer).metadata();

  assert.strictEqual(metadata.format, 'png');
  assert.ok(metadata.width);
  assert.ok(metadata.width > 0);
  assert.ok(metadata.height);
  assert.ok(metadata.height > 0);
}

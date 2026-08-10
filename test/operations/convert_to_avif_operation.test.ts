// Test target:
// - editable Draw.io画像をAVIFへ変換するとき、Draw.io CLIへAVIF/JPEG直接出力を要求せずPDFを経由すること
// - PDFからAVIFへ変換するとき、PNGを中間形式に使うこと
//
// Not tested:
// - Draw.io CLI実体での変換
// - PDF renderer実体での変換
// - 画像内容のpixel完全一致

import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { executeRasterConversion, rasterFormatSpecs } from '../../src/operations/conversion/raster_conversion.js';
import { requireValue } from '../helpers/required.js';

suite('Draw.io画像をPDF・PNG経由でAVIFへ変換する', () => {
  test('editableな.drawio.pngをDraw.io CLIへPDF出力（-x -f pdf）で渡し、そのPDFをPNGへ変換してからAVIF（heif）へ変換し、出力ファイルを生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-avif-operation-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'source', '1.avif');
    const drawioCalls: string[][] = [];
    const pdfToPngCalls: { sourcePath: string; outputPath: string; page: number }[] = [];
    await writeFile(sourcePath, 'editable drawio image placeholder');

    await executeRasterConversion({
      spec: rasterFormatSpecs.avif,
      maxInputPixels: 1_000_000_000,
      inputs: [
        {
          sourcePath,
          outputPath,
          workspacePath: workspacePath.path,
          page: 1,
        },
      ],
      pdfRenderTools: {
        runPdfToPng: async (pdfPath, pngPath, page) => {
          pdfToPngCalls.push({ sourcePath: pdfPath, outputPath: pngPath, page });
          await sharp({
            create: {
              width: 12,
              height: 8,
              channels: 4,
              background: '#285078',
            },
          })
            .png()
            .toFile(pngPath);
        },
      },
      mermaidTools: {
        chromePath: 'chrome',
        mermaidPath: 'mmdc',
        theme: 'default',
        backgroundColor: 'white',
      },
      drawioTools: {
        drawioPath: 'drawio',
        runDrawio: async (_executable, args) => {
          drawioCalls.push(args);
          const outputIndex = args.indexOf('-o') + 1;
          assert.ok(outputIndex > 0);
          await writeFile(requireValue(args[outputIndex]), '%PDF-1.7\n');
        },
      },
      outputOptions: {
        effort: 0,
      },
      runtime: {},
      runId: 'test-run',
    });

    assert.strictEqual(drawioCalls.length, 1);
    const drawioArgs = requireValue(drawioCalls[0]);
    const expectedPdfPath = path.join(
      workspacePath.path,
      '.graphics-workbench',
      'convert-to-avif',
      'test-run',
      '1',
      'drawio.pdf',
    );
    assert.deepStrictEqual(drawioArgs.slice(0, 5), ['-x', '-f', 'pdf', '-o', expectedPdfPath]);
    assert.strictEqual(drawioArgs.at(-1), sourcePath);

    assert.deepStrictEqual(pdfToPngCalls, [
      {
        sourcePath: expectedPdfPath,
        outputPath: path.join(
          workspacePath.path,
          '.graphics-workbench',
          'convert-to-avif',
          'test-run',
          '1',
          'source.png',
        ),
        page: 1,
      },
    ]);

    const buffer = await readFile(outputPath);
    const metadata = await sharp(buffer).metadata();
    assert.strictEqual(metadata.format, 'heif');
    assert.ok(metadata.width);
    assert.ok(metadata.height);
  });
});

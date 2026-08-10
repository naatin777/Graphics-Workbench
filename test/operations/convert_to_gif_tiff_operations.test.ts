import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { executeRasterConversion, rasterFormatSpecs } from '../../src/operations/conversion/raster_conversion.js';
import { executeDrawio } from '../../src/operations/conversion/tools/drawio_tools.js';

function stubRunPdfToPng(): never {
  throw new Error('PDF to PNG rendering must not run in this test.');
}
suite('GIF/TIFFの各フレームを静止画像として出力する', () => {
  test('アニメーションGIFをTIFFへ・アニメーションTIFFをGIFへ、各フレームをページ指定で独立した単一フレームの静止画像として出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-gif-tiff-operation-'));

    const gifSourcePath = path.join(workspacePath.path, 'source.gif');
    const tiffSourcePath = path.join(workspacePath.path, 'source.tiff');
    await writeAnimatedGif(gifSourcePath);
    await writeAnimatedTiff(tiffSourcePath);
    const common = {
      pdfRenderTools: { runPdfToPng: stubRunPdfToPng },
      mermaidTools: { chromePath: 'chrome', mermaidPath: 'mmdc', theme: 'default', backgroundColor: 'white' },
      drawioTools: { drawioPath: 'drawio', runDrawio: executeDrawio },
      maxInputPixels: 1_000_000_000,
      runtime: {},
    };

    for (const [format, spec, sourcePath] of [
      ['gif', rasterFormatSpecs.gif, tiffSourcePath],
      ['tiff', rasterFormatSpecs.tiff, gifSourcePath],
    ] as const) {
      const outputPaths = [1, 2].map((page) => path.join(workspacePath.path, `${format}-${page}.${format}`));
      await executeRasterConversion({
        ...common,
        spec,
        jobs: outputPaths.map((outputPath, index) => ({
          sourcePath,
          outputPath,
          workspacePath: workspacePath.path,
          page: index + 1,
        })),
        runId: `test-${format}`,
      });

      for (const outputPath of outputPaths) {
        const metadata = await sharp(await readFile(outputPath)).metadata();
        assert.strictEqual(metadata.format, format);
        assert.strictEqual(metadata.pages ?? 1, 1);
      }
    }
  });
});

async function writeAnimatedGif(filePath: string): Promise<void> {
  const frames = await Promise.all([
    sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toBuffer(),
    sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } })
      .png()
      .toBuffer(),
  ]);
  await sharp(frames, { join: { animated: true } })
    .gif()
    .toFile(filePath);
}

async function writeAnimatedTiff(filePath: string): Promise<void> {
  const frames = await Promise.all([
    sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toBuffer(),
    sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } })
      .png()
      .toBuffer(),
  ]);
  await sharp(frames, { join: { animated: true } })
    .tiff()
    .toFile(filePath);
}

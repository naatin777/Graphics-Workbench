import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { getExtensionConfiguration } from '../../src/config/extension_configuration.js';
import {
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
} from '../../src/config/external_tools/external_tool_paths.js';
import { convertToPdfFiles } from '../../src/operations/conversion/convert_to_pdf.js';
import { executeAvifConversion } from '../../src/operations/conversion/convert_to_avif.js';
import { executeJpegConversion } from '../../src/operations/conversion/convert_to_jpeg.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { convertToSvgFiles } from '../../src/operations/conversion/convert_to_svg.js';
import { executeWebpConversion } from '../../src/operations/conversion/convert_to_webp.js';
import { operationEpsInputPath } from '../helpers/fixture_paths.js';

const EPS_FIXTURE = operationEpsInputPath;
const configuration = getExtensionConfiguration();
const GHOSTSCRIPT_PATH = readGhostscriptExecutablePath(configuration);
const PDFTOCAIRO_PATH = readPdftocairoExecutablePath(configuration);

suite('EPSの出力経路', () => {
  test('EPSをPDFへ変換する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-eps-pdf-'));
    try {
      const sourcePath = path.join(workspacePath, 'input.eps');
      const outputPath = path.join(workspacePath, 'output.pdf');
      await writeFile(sourcePath, await readFile(EPS_FIXTURE));

      await convertToPdfFiles({
        jobs: [{ sourcePath, outputPath, workspacePath }],
        supportedExtensions: ['.eps'],
        tools: { ghostscriptPath: GHOSTSCRIPT_PATH },
        operationName: 'test-eps',
      });

      const pdfBytes = await readFile(outputPath);
      const doc = await PDFDocument.load(pdfBytes);
      assert.ok(doc.getPageCount() >= 1, 'PDF should have at least 1 page');
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('EPSをPNGへ変換する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-eps-png-'));
    try {
      const sourcePath = path.join(workspacePath, 'input.eps');
      const outputPath = path.join(workspacePath, 'output.png');
      await writeFile(sourcePath, await readFile(EPS_FIXTURE));

      await executePngConversion({
        jobs: [{ sourcePath, outputPath, workspacePath }],
        pdftocairoTools: { pdftocairoPath: PDFTOCAIRO_PATH },
        ghostscriptTools: { ghostscriptPath: GHOSTSCRIPT_PATH },
        mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio' },
        runtime: { resolveConflicts: async () => 'overwrite' as const },
      });

      const buffer = await readFile(outputPath);
      const metadata = await sharp(buffer).metadata();
      assert.ok(metadata.width && metadata.width > 0, 'PNG should have valid width');
      assert.ok(metadata.height && metadata.height > 0, 'PNG should have valid height');
      assert.strictEqual(metadata.format, 'png');
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('EPSをJPEGへ変換する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-eps-jpeg-'));
    try {
      const sourcePath = path.join(workspacePath, 'input.eps');
      const outputPath = path.join(workspacePath, 'output.jpeg');
      await writeFile(sourcePath, await readFile(EPS_FIXTURE));

      await executeJpegConversion({
        jobs: [{ sourcePath, outputPath, workspacePath }],
        pdftocairoTools: { pdftocairoPath: PDFTOCAIRO_PATH },
        ghostscriptTools: { ghostscriptPath: GHOSTSCRIPT_PATH },
        mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio' },
        runtime: { resolveConflicts: async () => 'overwrite' as const },
      });

      const buffer = await readFile(outputPath);
      const metadata = await sharp(buffer).metadata();
      assert.ok(metadata.width && metadata.width > 0, 'JPEG should have valid width');
      assert.strictEqual(metadata.format, 'jpeg');
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('EPSをWebPへ変換する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-eps-webp-'));
    try {
      const sourcePath = path.join(workspacePath, 'input.eps');
      const outputPath = path.join(workspacePath, 'output.webp');
      await writeFile(sourcePath, await readFile(EPS_FIXTURE));

      await executeWebpConversion({
        jobs: [{ sourcePath, outputPath, workspacePath }],
        pdftocairoTools: { pdftocairoPath: PDFTOCAIRO_PATH },
        ghostscriptTools: { ghostscriptPath: GHOSTSCRIPT_PATH },
        mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio' },
        webp: { effort: 0 },
        runtime: { resolveConflicts: async () => 'overwrite' as const },
      });

      const buffer = await readFile(outputPath);
      const metadata = await sharp(buffer).metadata();
      assert.ok(metadata.width && metadata.width > 0, 'WebP should have valid width');
      assert.strictEqual(metadata.format, 'webp');
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('EPSをAVIFへ変換する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-eps-avif-'));
    try {
      const sourcePath = path.join(workspacePath, 'input.eps');
      const outputPath = path.join(workspacePath, 'output.avif');
      await writeFile(sourcePath, await readFile(EPS_FIXTURE));

      await executeAvifConversion({
        jobs: [{ sourcePath, outputPath, workspacePath }],
        pdftocairoTools: { pdftocairoPath: PDFTOCAIRO_PATH },
        ghostscriptTools: { ghostscriptPath: GHOSTSCRIPT_PATH },
        mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio' },
        avif: { effort: 0 },
        runtime: { resolveConflicts: async () => 'overwrite' as const },
      });

      const buffer = await readFile(outputPath);
      const metadata = await sharp(buffer).metadata();
      assert.ok(metadata.width && metadata.width > 0, 'AVIF should have valid width');
      assert.strictEqual(metadata.format, 'heif');
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('EPSをSVGへ変換する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-eps-svg-'));
    try {
      const sourcePath = path.join(workspacePath, 'input.eps');
      const outputPath = path.join(workspacePath, 'output.svg');
      await writeFile(sourcePath, await readFile(EPS_FIXTURE));

      await convertToSvgFiles({
        jobs: [{ sourcePath, outputPath, workspacePath }],
        pdftocairoTools: { pdftocairoPath: PDFTOCAIRO_PATH },
        ghostscriptTools: { ghostscriptPath: GHOSTSCRIPT_PATH },
        mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio' },
        runId: 'test-run',
        runtime: { resolveConflicts: async () => 'overwrite' as const },
      });

      const svgContent = await readFile(outputPath, 'utf8');
      assert.ok(svgContent.includes('<svg'), 'SVG output should contain <svg> element');
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('不正なEPSはpreflightで変換前に停止する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-eps-bad-'));
    try {
      const sourcePath = path.join(workspacePath, 'bad.eps');
      const outputPath = path.join(workspacePath, 'output.pdf');
      await writeFile(sourcePath, 'NOT AN EPS FILE');

      await assert.rejects(
        convertToPdfFiles({
          jobs: [{ sourcePath, outputPath, workspacePath }],
          supportedExtensions: ['.eps'],
          tools: { ghostscriptPath: GHOSTSCRIPT_PATH },
          operationName: 'test-eps',
        }),
        /Preflight validation failed|Ghostscript failed|Unrecoverable error|gs.*failed/,
      );
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

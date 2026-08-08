import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, mkdtempDisposable, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PDFDocument } from 'pdf-lib';

import {
  convertExcalidrawToPdfFiles,
  type ExcalidrawPdfJob,
} from '../../src/operations/conversion/convert_excalidraw_to_pdf.js';
import { ExcalidrawError } from '../../src/operations/conversion/excalidraw_scene.js';
import type { SvgToPdfBackend } from '../../src/operations/conversion/tools/svg_to_pdf_tools.js';
import { testInputDirectory } from '../helpers/fixture_paths.js';

const fakeBundleModule = `export async function exportToSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', '0 0 200 100');
  svg.setAttribute('width', '200');
  svg.setAttribute('height', '100');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '50');
  rect.setAttribute('height', '50');
  svg.appendChild(rect);
  return svg;
}
`;

suite('Excalidraw → PDF変換', () => {
  test('Excalidraw sceneをPDFへ変換してstagingを掃除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-excalidraw-pdf-'));
    const { fakeBundlePath, cleanupBundle } = await writeFakeBundle();

    try {
      const sourcePath = path.join(workspacePath.path, 'diagram.excalidraw');
      await copyFile(path.join(testInputDirectory, 'valid', 'excalidraw', 'background-color.excalidraw'), sourcePath);
      const originalSource = await readFile(sourcePath, 'utf8');

      const outputs = await convertExcalidrawToPdfFiles({
        jobs: [createJob(sourcePath, workspacePath.path)],
        svgToPdf: createStubSvgToPdfOptions(),
        runId: 'excalidraw-test',
        runtime: { resolveConflicts: async () => 'overwrite' },
        bundleUrl: fakeBundlePath,
      });

      assert.deepStrictEqual(
        outputs.map(({ outputPath }) => outputPath),
        [path.join(workspacePath.path, 'diagram.pdf')],
      );
      assert.strictEqual(
        await PDFDocument.load(await readFile(requireValue(outputs[0]).outputPath)).then((pdf) => pdf.getPageCount()),
        1,
      );
      assert.strictEqual(await readFile(sourcePath, 'utf8'), originalSource);
    } finally {
      await cleanupBundle();
    }
  });

  test('不正なsceneは失敗し出力とstagingを残さない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-excalidraw-invalid-'));
    const { fakeBundlePath, cleanupBundle } = await writeFakeBundle();

    try {
      const sourcePath = path.join(workspacePath.path, 'broken.excalidraw');
      await writeFile(sourcePath, '{ not json');

      await assert.rejects(
        convertExcalidrawToPdfFiles({
          jobs: [createJob(sourcePath, workspacePath.path)],
          svgToPdf: createStubSvgToPdfOptions(),
          runId: 'invalid-test',
          runtime: { resolveConflicts: async () => 'overwrite' },
          bundleUrl: fakeBundlePath,
        }),
        (error) => error instanceof ExcalidrawError && error.category === 'json',
      );

      assert.strictEqual(existsSync(path.join(workspacePath.path, 'broken.pdf')), false);
      assert.strictEqual(
        existsSync(path.join(workspacePath.path, '.graphics-workbench', 'convert-excalidraw-to-pdf', 'invalid-test')),
        false,
        'staging root must be removed after a failed conversion',
      );
    } finally {
      await cleanupBundle();
    }
  });
});

function createJob(sourcePath: string, workspacePath: string): ExcalidrawPdfJob {
  return {
    sourcePath,
    outputTemplate: '${fileDirname}/${fileBasenameNoExtension}.pdf',
    workspacePath,
    workspaceName: path.basename(workspacePath),
  };
}

function createStubSvgToPdfOptions(): SvgToPdfBackend {
  return {
    engine: 'chrome',
    rsvgConvertPath: 'rsvg-convert',
    chromePath: 'chrome',
    runChrome: async (_executable, args) => {
      const outputArg = args.find((arg) => arg.startsWith('--print-to-pdf='));
      const outputPath = outputArg?.slice('--print-to-pdf='.length);
      assert.ok(outputPath, 'chrome args must include --print-to-pdf');
      await writePdfPages(outputPath, 1);
    },
  };
}

async function writePdfPages(filePath: string, pageCount: number): Promise<void> {
  const document = await PDFDocument.create();
  for (let page = 1; page <= pageCount; page += 1) {
    document.addPage([200, 100]);
  }
  await writeFile(filePath, await document.save());
}

async function writeFakeBundle(): Promise<{ fakeBundlePath: string; cleanupBundle: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gw-excalidraw-bundle-'));
  const fakeBundlePath = path.join(directory, 'fake-excalidraw-adapter.mjs');
  await writeFile(fakeBundlePath, fakeBundleModule);
  return {
    fakeBundlePath: pathToFileURL(fakeBundlePath).href,
    cleanupBundle: () => rm(directory, { recursive: true, force: true }),
  };
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a defined value');
  }
  return value;
}

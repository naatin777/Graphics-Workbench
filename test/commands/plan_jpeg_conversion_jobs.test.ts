import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { planJpegConversionJobs } from '../../src/commands/conversion/plan_jpeg_conversion_jobs.js';
import { getCommandConfiguration } from '../../src/commands/shared/command_utils.js';
import { getDefaultConfiguration } from '../../src/generated/extension_manifest.js';
import { requireValue } from '../helpers/required.js';

suite('JPEG変換planner', () => {
  test('2ページPDFをページごとのJPEG jobへ展開する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const temporaryDirectory = await mkdtemp(path.join(workspace.uri.fsPath, 'graphics-workbench-plan-jpeg-'));

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.pdf');
      const document = await PDFDocument.create();
      document.addPage([200, 150]);
      document.addPage([200, 150]);
      await writeFile(sourcePath, await document.save());

      const jobs = await planJpegConversionJobs(
        vscode.Uri.file(sourcePath),
        getCommandConfiguration(),
        getDefaultConfiguration(),
        getDefaultConfiguration().raster.maxInputPixels(),
      );

      assert.deepStrictEqual(
        jobs.map(({ sourcePath: jobSourcePath, workspacePath, outputPath, page }) => ({
          sourcePath: jobSourcePath,
          workspacePath,
          outputPath,
          page,
        })),
        [
          {
            sourcePath,
            workspacePath: workspace.uri.fsPath,
            outputPath: path.join(temporaryDirectory, 'source-1.jpeg'),
            page: 1,
          },
          {
            sourcePath,
            workspacePath: workspace.uri.fsPath,
            outputPath: path.join(temporaryDirectory, 'source-2.jpeg'),
            page: 2,
          },
        ],
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('通常のJPEG入力を同一形式変換として拒否する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sourcePath = path.join(workspace.uri.fsPath, 'source.jpeg');

    await assert.rejects(
      planJpegConversionJobs(
        vscode.Uri.file(sourcePath),
        getCommandConfiguration(),
        getDefaultConfiguration(),
        getDefaultConfiguration().raster.maxInputPixels(),
      ),
      new RegExp(`Unsupported input for JPEG conversion: ${escapeRegExp(sourcePath)}`),
    );
  });
});

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { planAvifConversionJobs } from '../../src/commands/conversion/plan_avif_conversion_jobs.js';
import { getCommandConfiguration } from '../../src/commands/shared/command_utils.js';
import { getDefaultConfiguration } from '../../src/generated/extension_manifest.js';
import { requireValue } from '../helpers/required.js';

suite('AVIF変換planner', () => {
  test('2ページPDFをページごとのAVIF jobへ展開する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const temporaryDirectory = await mkdtemp(path.join(workspace.uri.fsPath, 'graphics-workbench-plan-avif-'));

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.pdf');
      const document = await PDFDocument.create();
      document.addPage([200, 150]);
      document.addPage([200, 150]);
      await writeFile(sourcePath, await document.save());

      const jobs = await planAvifConversionJobs(
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
            outputPath: path.join(temporaryDirectory, 'source-1.avif'),
            page: 1,
          },
          {
            sourcePath,
            workspacePath: workspace.uri.fsPath,
            outputPath: path.join(temporaryDirectory, 'source-2.avif'),
            page: 2,
          },
        ],
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('通常のAVIF入力を同一形式変換として拒否する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sourcePath = path.join(workspace.uri.fsPath, 'source.avif');

    await assert.rejects(
      planAvifConversionJobs(
        vscode.Uri.file(sourcePath),
        getCommandConfiguration(),
        getDefaultConfiguration(),
        getDefaultConfiguration().raster.maxInputPixels(),
      ),
      new RegExp(`Unsupported input for AVIF conversion: ${escapeRegExp(sourcePath)}`),
    );
  });
});

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

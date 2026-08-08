import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { planTiffConversionJobs } from '../../src/commands/conversion/plan_tiff_conversion_jobs.js';
import { configureCommandRuntime } from '../../src/commands/shared/command_runtime.js';
import { requireValue } from '../helpers/required.js';

suite('TIFF変換planner', () => {
  test('2ページPDFをページごとのTIFF jobへ展開する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    await using temporaryDirectory = await mkdtempDisposable(path.join(workspace.uri.fsPath, 'gw-plan-tiff-'));

    const sourcePath = path.join(temporaryDirectory.path, 'source.pdf');
    const document = await PDFDocument.create();
    document.addPage([200, 150]);
    document.addPage([200, 150]);
    await writeFile(sourcePath, await document.save());

    const jobs = await planTiffConversionJobs(vscode.Uri.file(sourcePath), configureCommandRuntime(), 100_000_000);

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
          outputPath: path.join(temporaryDirectory.path, 'source-1.tiff'),
          page: 1,
        },
        {
          sourcePath,
          workspacePath: workspace.uri.fsPath,
          outputPath: path.join(temporaryDirectory.path, 'source-2.tiff'),
          page: 2,
        },
      ],
    );
  });

  test('通常のTIFF入力を同一形式変換として拒否する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sourcePath = path.join(workspace.uri.fsPath, 'source.tiff');

    await assert.rejects(
      planTiffConversionJobs(vscode.Uri.file(sourcePath), configureCommandRuntime(), 100_000_000),
      new RegExp(`Unsupported input for TIFF conversion: ${RegExp.escape(sourcePath)}`),
    );
  });
});

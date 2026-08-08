import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { planPngConversionJobs } from '../../src/commands/conversion/plan_png_conversion_jobs.js';
import { configureCommandRuntime } from '../../src/commands/shared/command_runtime.js';
import { getDefaultConfiguration } from '../../src/generated/extension_manifest.js';
import { requireValue } from '../helpers/required.js';

suite('PNG変換planner', () => {
  test('2ページPDFをページごとのPNG jobへ展開する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    await using temporaryDirectory = await mkdtempDisposable(path.join(workspace.uri.fsPath, 'gw-plan-png-'));

    const sourcePath = path.join(temporaryDirectory.path, 'source.pdf');
    const document = await PDFDocument.create();
    document.addPage([200, 150]);
    document.addPage([200, 150]);
    await writeFile(sourcePath, await document.save());

    const jobs = await planPngConversionJobs(
      vscode.Uri.file(sourcePath),
      configureCommandRuntime(),
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
          outputPath: path.join(temporaryDirectory.path, 'source-1.png'),
          page: 1,
        },
        {
          sourcePath,
          workspacePath: workspace.uri.fsPath,
          outputPath: path.join(temporaryDirectory.path, 'source-2.png'),
          page: 2,
        },
      ],
    );
  });

  test('通常のPNG入力を同一形式変換として拒否する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sourcePath = path.join(workspace.uri.fsPath, 'source.png');

    await assert.rejects(
      planPngConversionJobs(
        vscode.Uri.file(sourcePath),
        configureCommandRuntime(),
        getDefaultConfiguration().raster.maxInputPixels(),
      ),
      new RegExp(`Unsupported input for PNG conversion: ${RegExp.escape(sourcePath)}`),
    );
  });
});

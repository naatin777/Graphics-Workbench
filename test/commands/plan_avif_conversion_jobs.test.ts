import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { planAvifConversionJobs } from '../../src/commands/conversion/plan_avif_conversion_jobs.js';
import { configureCommandRuntime } from '../../src/commands/shared/command_runtime.js';
import { getDefaultConfiguration } from '../../src/generated/extension_manifest.js';
import { operationPngInputPath } from '../helpers/fixture_paths.js';
import { requireValue } from '../helpers/required.js';

suite('AVIF変換planner', () => {
  test('2ページPDFをページごとのAVIF jobへ展開する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    await using temporaryDirectory = await mkdtempDisposable(path.join(workspace.uri.fsPath, 'gw-plan-avif-'));

    const sourcePath = path.join(temporaryDirectory.path, 'source.pdf');
    const document = await PDFDocument.create();
    document.addPage([200, 150]);
    document.addPage([200, 150]);
    await writeFile(sourcePath, await document.save());

    const jobs = await planAvifConversionJobs(
      vscode.Uri.file(sourcePath),
      configureCommandRuntime(),
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
          outputPath: path.join(temporaryDirectory.path, 'source-1.avif'),
          page: 1,
        },
        {
          sourcePath,
          workspacePath: workspace.uri.fsPath,
          outputPath: path.join(temporaryDirectory.path, 'source-2.avif'),
          page: 2,
        },
      ],
    );
  });

  test('raster sourceを共通planner経由でAVIF jobへ展開する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    await using temporaryDirectory = await mkdtempDisposable(path.join(workspace.uri.fsPath, 'gw-plan-avif-'));

    const sourcePath = path.join(temporaryDirectory.path, 'source.png');
    await copyFile(operationPngInputPath, sourcePath);

    const jobs = await planAvifConversionJobs(
      vscode.Uri.file(sourcePath),
      configureCommandRuntime(),
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
          outputPath: path.join(temporaryDirectory.path, 'source.avif'),
          page: 1,
        },
      ],
    );
  });

  test('通常のAVIF入力を同一形式変換として拒否する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    const sourcePath = path.join(workspace.uri.fsPath, 'source.avif');

    await assert.rejects(
      planAvifConversionJobs(
        vscode.Uri.file(sourcePath),
        configureCommandRuntime(),
        getDefaultConfiguration(),
        getDefaultConfiguration().raster.maxInputPixels(),
      ),
      new RegExp(`Unsupported input for AVIF conversion: ${RegExp.escape(sourcePath)}`),
    );
  });
});

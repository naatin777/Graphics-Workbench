import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable } from 'node:fs/promises';
import path from 'node:path';

import * as vscode from 'vscode';

import { planRasterSourceConversionJobs } from '../../src/commands/conversion/plan_raster_source_conversion_jobs.js';
import { getDefaultConfiguration } from '../../src/generated/extension_manifest.js';
import { operationPngInputPath } from '../helpers/fixture_paths.js';
import { requireValue } from '../helpers/required.js';

suite('raster source planner', () => {
  test('raster sourceを指定形式のpage jobへ展開する', async () => {
    const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
    await using temporaryDirectory = await mkdtempDisposable(path.join(workspace.uri.fsPath, 'gw-plan-raster-'));

    const sourcePath = path.join(temporaryDirectory.path, 'source.png');
    await copyFile(operationPngInputPath, sourcePath);

    const jobs = await planRasterSourceConversionJobs({
      sourcePath,
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
      outputTemplate: '${fileDirname}/${fileBasenameNoExtension}-${page}.jpeg',
      allowedExtensions: ['.jpeg'],
      maxInputPixels: getDefaultConfiguration().raster.maxInputPixels(),
    });

    assert.deepStrictEqual(jobs, [
      {
        sourcePath,
        workspacePath: workspace.uri.fsPath,
        outputPath: path.join(temporaryDirectory.path, 'source-1.jpeg'),
        page: 1,
      },
    ]);
  });
});

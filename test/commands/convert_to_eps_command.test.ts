import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { createEpsJobs } from '../../src/commands/conversion/convert_to_eps.js';
import { fakeConfiguration } from '../helpers/configuration.js';
import { testInputDirectory } from '../helpers/fixture_paths.js';

suite('EPS変換コマンドジョブ', () => {
  test('PDFページごとに${page}ジョブを個別に作成する', async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspace);
    const root = await mkdtemp(path.join(workspace.uri.fsPath, 'graphics-workbench-convert-to-eps-command-'));
    const sourcePath = path.join(root, 'source.pdf');

    try {
      await mkdir(root, { recursive: true });
      const document = await PDFDocument.create();
      document.addPage([100, 80]);
      document.addPage([100, 80]);
      await writeFile(sourcePath, await document.save());
      const configuration = fakeConfiguration();
      const jobs = await createEpsJobs(vscode.Uri.file(sourcePath), configuration);

      assert.deepStrictEqual(
        jobs.map((job) => job.page),
        [1, 2],
      );
      assert.deepStrictEqual(
        jobs.map((job) => path.basename(job.outputPath)),
        ['source-1.eps', 'source-2.eps'],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('outputPaths.convertPdfToEpsが設定されている場合はカスタムテンプレートを使う', async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspace);
    const root = await mkdtemp(path.join(workspace.uri.fsPath, 'graphics-workbench-convert-to-eps-output-path-'));
    const sourcePath = path.join(root, 'source.pdf');

    try {
      await mkdir(root, { recursive: true });
      const document = await PDFDocument.create();
      document.addPage([100, 80]);
      await writeFile(sourcePath, await document.save());
      const configuration = fakeConfiguration({
        outputPaths: { convertPdfToEps: '${fileDirname}/custom-${fileBasenameNoExtension}-${page}.eps' },
      });
      const jobs = await createEpsJobs(vscode.Uri.file(sourcePath), configuration);

      assert.strictEqual(jobs.length, 1);
      assert.deepStrictEqual(
        jobs.map((job) => path.basename(job.outputPath)),
        ['custom-source-1.eps'],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('GIF、TIFFをEPSジョブとして計画する', async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspace);
    const root = await mkdtemp(path.join(workspace.uri.fsPath, 'graphics-workbench-convert-to-eps-command-raster-'));

    try {
      await mkdir(root, { recursive: true });
      const configuration = fakeConfiguration();

      for (const [format, fixtureFileName] of [
        ['gif', 'swirl-gradient.gif'],
        ['tiff', 'heatmap.tiff'],
      ] as const) {
        const sourcePath = path.join(root, fixtureFileName);
        await copyFile(path.join(testInputDirectory, 'valid', format, fixtureFileName), sourcePath);

        const jobs = await createEpsJobs(vscode.Uri.file(sourcePath), configuration);
        assert.strictEqual(jobs.length, 1);
        assert.ok(jobs[0]?.outputPath.endsWith('.eps'));
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('editable Draw.io画像をconvertDrawioToEpsテンプレートで計画する', async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspace);
    const root = await mkdtemp(path.join(workspace.uri.fsPath, 'graphics-workbench-convert-to-eps-command-drawio-'));

    try {
      await mkdir(root, { recursive: true });
      const sourcePath = path.join(root, 'source.drawio.png');
      await copyFile(path.join(testInputDirectory, 'valid', 'drawio', 'multi-object-diagram.drawio.png'), sourcePath);
      const configuration = fakeConfiguration({
        outputPaths: { convertDrawioToEps: '${fileDirname}/custom-${fileBasenameNoExtension}.eps' },
      });

      const jobs = await createEpsJobs(vscode.Uri.file(sourcePath), configuration);
      assert.strictEqual(jobs.length, 1);
      assert.deepStrictEqual(path.basename(jobs[0]?.outputPath ?? ''), 'custom-source.eps');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('native Draw.ioファイルはEPS変換を拒否する', async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspace);
    const root = await mkdtemp(
      path.join(workspace.uri.fsPath, 'graphics-workbench-convert-to-eps-command-native-drawio-'),
    );

    try {
      await mkdir(root, { recursive: true });
      const sourcePath = path.join(root, 'source.drawio');
      await copyFile(path.join(testInputDirectory, 'valid', 'drawio', 'unicode-page-names.drawio'), sourcePath);

      await assert.rejects(createEpsJobs(vscode.Uri.file(sourcePath), fakeConfiguration()), /Native Draw\.io input/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

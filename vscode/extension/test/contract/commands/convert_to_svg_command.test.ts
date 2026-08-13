// Test target:
// - graphics-workbench.convertToSvg commandが登録されること
// - PDFをページごとのSVGへ変換できること
// - SVG出力が壊れていないこと
//
// Mocked:
// - VS Codeの通知API。通知UIの選択はここでは対象外にし、command completionを直接検証する。
//
// Not tested:
// - Draw.io → SVGの実CLI経路
//   - fake Draw.io CLIをcommand testで直接扱うとWindowsのexecFile差で不安定になりやすい。
//   - runnerを注入できるoperation testとして固定する。
// - context menuの画面上の表示
// - Safe Modeダイアログの画面表示
// - VS Codeのprogress notificationの画面表示
// - cancellation tokenのUI操作

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from '@graphics-workbench/core/testing';
import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { runCommandAndClearNotificationsUntilDone } from '../../support/helpers/vscode_command.js';
import { withWorkspaceSettings } from '../../support/helpers/workspace_settings.js';

suite('SVGに変換コマンド', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = createSandbox();
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
  });

  teardown(() => {
    sandbox.restore();
  });

  test('2ページPDFをページごとのSVGへ変換し、source-document/1.svgとsource-document/2.svgを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const pdfPath = path.join(temporaryDirectory, 'source-document.pdf');
      await writeTwoPagePdf(pdfPath);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.convertToSvg',
        vscode.Uri.file(pdfPath),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      await assertGeneratedSvg(path.join(temporaryDirectory, 'source-document', '1.svg'));
      await assertGeneratedSvg(path.join(temporaryDirectory, 'source-document', '2.svg'));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('outputPath.split.svgが設定済みの場合、2ページPDFを${page}ごとに展開したto-svg-source-1.svgとto-svg-source-2.svgを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.pdf');
      const firstOutputPath = path.join(temporaryDirectory, 'to-svg-source-1.svg');
      const secondOutputPath = path.join(temporaryDirectory, 'to-svg-source-2.svg');
      await writeTwoPagePdf(sourcePath);

      await withWorkspaceSettings(
        {
          'graphics-workbench.outputPath.split.svg': '${fileDirname}/to-svg-${fileBasenameNoExtension}-${page}.svg',
        },
        async () => {
          const commandExecution = vscode.commands.executeCommand(
            'graphics-workbench.convertToSvg',
            vscode.Uri.file(sourcePath),
          );
          await runCommandAndClearNotificationsUntilDone(commandExecution);
        },
      );

      await assertGeneratedSvg(firstOutputPath);
      await assertGeneratedSvg(secondOutputPath);
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });
});

async function createTemporaryWorkspaceDirectory(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder);

  const temporaryDirectory = await mkdtemp(path.join(workspaceFolder.uri.fsPath, 'gw-convert-to-svg-'));
  await mkdir(temporaryDirectory, { recursive: true });
  return temporaryDirectory;
}

async function removeTemporaryDirectory(directoryPath: string): Promise<void> {
  await rm(directoryPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

async function writeTwoPagePdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create();
  document.addPage([72, 36]);
  document.addPage([36, 72]);
  await writeFile(filePath, await document.save());
}

async function assertGeneratedSvg(filePath: string): Promise<void> {
  const svg = await readFile(filePath, 'utf8');

  assert.match(svg, /<svg[\s>]/);
}

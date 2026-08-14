import assert from 'node:assert/strict';
import { access, copyFile, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { operationPngInputPath, testInputDirectory } from '../../support/helpers/testdata_paths.js';
import { requireValue } from '@graphics-workbench/core/testing';
import { runCommandAndClearNotificationsUntilDone } from '../../support/helpers/vscode_command.js';
import { withWorkspaceSettings } from '../../support/helpers/workspace_settings.js';

const testDataPngPath = operationPngInputPath;

const rasterCommandMatrix = [
  { commandId: 'graphics-workbench.convertToPng', inputExtension: 'jpeg', extension: 'png', sharpFormat: 'png' },
  { commandId: 'graphics-workbench.convertToJpeg', inputExtension: 'png', extension: 'jpeg', sharpFormat: 'jpeg' },
  { commandId: 'graphics-workbench.convertToWebp', inputExtension: 'png', extension: 'webp', sharpFormat: 'webp' },
  { commandId: 'graphics-workbench.convertToAvif', inputExtension: 'png', extension: 'avif', sharpFormat: 'heif' },
  { commandId: 'graphics-workbench.convertToGif', inputExtension: 'png', extension: 'gif', sharpFormat: 'gif' },
  { commandId: 'graphics-workbench.convertToTiff', inputExtension: 'png', extension: 'tiff', sharpFormat: 'tiff' },
] as const;

suite('ラスター変換commandのrouting smoke', () => {
  let sandbox: sinon.SinonSandbox;
  let showErrorMessage: sinon.SinonStub;
  let showInformationMessage: sinon.SinonStub;

  setup(async () => {
    sandbox = createSandbox();
    showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    const configuration = vscode.workspace.getConfiguration('graphics-workbench');
    await configuration.update('convertToWebp.effort', 0, vscode.ConfigurationTarget.Workspace);
    await configuration.update('convertToAvif.effort', 0, vscode.ConfigurationTarget.Workspace);
  });

  teardown(async () => {
    const configuration = vscode.workspace.getConfiguration('graphics-workbench');
    await configuration.update('convertToWebp.effort', undefined, vscode.ConfigurationTarget.Workspace);
    await configuration.update('convertToAvif.effort', undefined, vscode.ConfigurationTarget.Workspace);
    sandbox.restore();
  });

  function defineRasterCommandCase(entry: (typeof rasterCommandMatrix)[number]): void {
    const { commandId, inputExtension, extension, sharpFormat } = entry;

    test(`${commandId}が${inputExtension.toUpperCase()}入力からsource.${extension}を生成し、成功通知を表示する`, async () => {
      await using workspacePath = await mkdtempDisposable(
        path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'gw-raster-smoke-'),
      );
      const sourcePath = path.join(workspacePath.path, `source.${inputExtension}`);
      if (inputExtension === 'png') {
        await copyFile(testDataPngPath, sourcePath);
      } else {
        await sharp(await readFile(testDataPngPath))
          .jpeg()
          .toFile(sourcePath);
      }

      const commandExecution = vscode.commands.executeCommand(commandId, vscode.Uri.file(sourcePath));
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      assert.ok(showInformationMessage.calledOnce);
      assert.ok(showErrorMessage.notCalled);
      await assertReadableRaster(path.join(workspacePath.path, `source.${extension}`), sharpFormat);
    });
  }

  for (const entry of rasterCommandMatrix) {
    defineRasterCommandCase(entry);
  }

  test('convertToPngがPNG入力を同一形式として拒否し、エラー通知を表示して入力を変更しない', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'gw-raster-smoke-reject-'),
    );
    const sourcePath = path.join(workspacePath.path, 'source.png');
    await copyFile(testDataPngPath, sourcePath);
    const originalContent = await readFile(sourcePath);

    await vscode.commands.executeCommand('graphics-workbench.convertToPng', vscode.Uri.file(sourcePath));

    assert.ok(showErrorMessage.calledOnce);
    assert.match(String(showErrorMessage.firstCall.args[0]), /Unsupported input for PNG input/);
    assert.deepStrictEqual(await readFile(sourcePath), originalContent);
  });

  test('outputPath.split.pngが空文字の場合はinvalid configurationとして変換せず、エラー通知を表示して出力を生成しない', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'gw-raster-smoke-config-'),
    );
    const sourcePath = path.join(workspacePath.path, 'source.jpeg');
    await sharp(await readFile(testDataPngPath))
      .jpeg()
      .toFile(sourcePath);

    await withWorkspaceSettings(
      {
        'graphics-workbench.outputPath.split.png': '',
      },
      async () => {
        await vscode.commands.executeCommand('graphics-workbench.convertToPng', vscode.Uri.file(sourcePath));
      },
    );

    assert.ok(showErrorMessage.calledOnce);
    assert.match(
      String(showErrorMessage.firstCall.args[0]),
      /Invalid configuration for graphics-workbench\.outputPath\.split\.png/,
    );
    await assertFileDoesNotExist(path.join(workspacePath.path, 'source.png'));
  });

  test('convertToWebpSplitがGIFの各フレームを連番01、02のWebPへ分割出力する', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'gw-raster-smoke-split-'),
    );
    const sourcePath = path.join(workspacePath.path, 'rotating-vector-field.gif');
    await copyFile(path.join(testInputDirectory, 'valid', 'gif', 'rotating-vector-field.gif'), sourcePath);

    const commandExecution = vscode.commands.executeCommand(
      'graphics-workbench.convertToWebpSplit',
      vscode.Uri.file(sourcePath),
    );
    await runCommandAndClearNotificationsUntilDone(commandExecution);

    assert.ok(showInformationMessage.calledOnce);
    assert.ok(showErrorMessage.notCalled);
    await assertReadableRaster(path.join(workspacePath.path, 'rotating-vector-field', '01.webp'), 'webp');
    await assertReadableRaster(path.join(workspacePath.path, 'rotating-vector-field', '02.webp'), 'webp');
  });

  test('convertToGifがanimated WebPを複数フレームのGIFへ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'gw-raster-smoke-animation-'),
    );
    const sourcePath = path.join(workspacePath.path, 'animated-swirl.webp');
    await copyFile(path.join(testInputDirectory, 'valid', 'webp', 'animated-swirl.webp'), sourcePath);

    const commandExecution = vscode.commands.executeCommand(
      'graphics-workbench.convertToGif',
      vscode.Uri.file(sourcePath),
    );
    await runCommandAndClearNotificationsUntilDone(commandExecution);

    assert.ok(showInformationMessage.calledOnce);
    assert.ok(showErrorMessage.notCalled);
    const metadata = await sharp(path.join(workspacePath.path, 'animated-swirl.gif')).metadata();
    assert.strictEqual(metadata.format, 'gif');
    assert.ok((metadata.pages ?? 1) > 1);
  });

  test('convertToPngがSVG入力を読み取り可能なPNGへ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(
      path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, 'gw-raster-smoke-svg-'),
    );
    const sourcePath = path.join(workspacePath.path, 'source.svg');
    await writeFile(
      sourcePath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="31" height="19" viewBox="0 0 31 19"><rect width="31" height="19" fill="#285078"/></svg>',
    );

    const commandExecution = vscode.commands.executeCommand(
      'graphics-workbench.convertToPng',
      vscode.Uri.file(sourcePath),
    );
    await runCommandAndClearNotificationsUntilDone(commandExecution);

    assert.ok(showInformationMessage.calledOnce);
    await assertReadableRaster(path.join(workspacePath.path, 'source.png'), 'png');
  });
});

async function assertReadableRaster(filePath: string, expectedFormat: string): Promise<void> {
  await assert.doesNotReject(access(filePath));
  const metadata = await sharp(await readFile(filePath)).metadata();
  assert.strictEqual(metadata.format, expectedFormat);
  assert.ok(metadata.width && metadata.width > 0);
  assert.ok(metadata.height && metadata.height > 0);
}

async function assertFileDoesNotExist(filePath: string): Promise<void> {
  await assert.rejects(access(filePath), (error) => {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  });
}

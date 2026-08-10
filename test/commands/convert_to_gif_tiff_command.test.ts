import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { convertToRasterCommand } from '../../src/commands/conversion/convert_to_raster.js';
import { liveCommandDependencies } from '../helpers/command_dependencies.js';
import { requireValue } from '../helpers/required.js';

suite('GIF/TIFFに変換コマンド', () => {
  test('2フレームのGIF入力をTIFFへ変換し、出力が1ページのTIFFになる', async () => {
    await assertAnimatedInputIsSplit('gif', 'tiff', { target: 'tiff' });
  });

  test('2ページのTIFF入力をGIFへ変換し、出力が1ページのGIFになる', async () => {
    await assertAnimatedInputIsSplit('tiff', 'gif', { target: 'gif' });
  });
});

async function assertAnimatedInputIsSplit(
  format: 'gif' | 'tiff',
  outputFormat: 'gif' | 'tiff',
  options: { target: 'gif' | 'tiff' },
): Promise<void> {
  await using workspacePath = await mkdtempDisposable(
    path.join(requireValue(vscode.workspace.workspaceFolders?.[0]).uri.fsPath, `gw-${format}-command-`),
  );
  const workspaceConfiguration = vscode.workspace.getConfiguration('graphics-workbench');
  const sandbox = createSandbox();
  const key = outputFormat === 'gif' ? 'single.gif' : 'single.tiff';
  const template = `\${fileDirname}/\${fileBasenameNoExtension}.${outputFormat}`;

  try {
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    const sourcePath = path.join(workspacePath.path, `source.${format}`);
    await writeAnimatedImage(sourcePath, format);
    await workspaceConfiguration.update(`outputPath.${key}`, template, vscode.ConfigurationTarget.Workspace);
    await convertToRasterCommand([vscode.Uri.file(sourcePath)], liveCommandDependencies(), options);

    const outputPath = path.join(workspacePath.path, `source.${outputFormat}`);
    const metadata = await sharp(await readFile(outputPath)).metadata();
    assert.strictEqual(metadata.format, outputFormat);
    assert.strictEqual(metadata.pages ?? 1, 1);
  } finally {
    sandbox.restore();
    await workspaceConfiguration.update(`outputPath.${key}`, undefined, vscode.ConfigurationTarget.Workspace);
  }
}

async function writeAnimatedImage(filePath: string, format: 'gif' | 'tiff'): Promise<void> {
  const frames = await Promise.all([
    sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
      .png()
      .toBuffer(),
    sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } })
      .png()
      .toBuffer(),
  ]);
  const output = sharp(frames, { join: { animated: true } });
  await (format === 'gif' ? output.gif() : output.tiff()).toFile(filePath);
}

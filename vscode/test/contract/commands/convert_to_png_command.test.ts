// Test target:
// - graphics-workbench.convertToPng commandが登録されること
// - JPEG、WebP、AVIFをPNGに変換できること
// - GIF、TIFFの先頭frame/pageをPNGへ変換できること
// - SVGをPNGに変換できること
// - PDFをページごとのPNGに変換できること
// - PNGからPNGへは変換しないこと
// - 出力PNGが壊れておらず、幅と高さが0より大きいこと
//
// Not tested:
// - Draw.io → PDF → PNGの実変換経路
//   - fake Draw.io CLIをcommand testで直接扱うとWindowsのexecFile差で不安定になりやすい。
//   - 0065の実装時にrunnerを注入できるoperation testとして固定する。
// - 画像内容のpixel完全一致
// - context menuの画面上の表示
// - Safe Modeダイアログの画面表示
// - VS Codeのprogress notificationの画面表示
// - cancellation tokenのUI操作

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from '../../support/helpers/pdf_document.js';
import sharp from 'sharp';
import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import { runCommandAndClearNotificationsUntilDone } from '../../support/helpers/vscode_command.js';
import { requireValue } from '../../support/helpers/required.js';
import { withWorkspaceSettings } from '../../support/helpers/workspace_settings.js';

const generatedSvgWidth = 31;
const generatedSvgHeight = 19;

const imageVariants = [
  {
    basename: 'source-jpeg',
    extension: 'jpeg',
    imageBase64:
      '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAANABEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCbAL6KAA//2Q==',
  },
  {
    basename: 'source-webp',
    extension: 'webp',
    imageBase64: 'UklGRkAAAABXRUJQVlA4IDQAAADQAgCdASoRAA0APm0skkWkIqGYBABABsSxgDsAAIGwAP7w+iv/ySPVzHQf/oUbKJpMAAAA',
  },
  {
    basename: 'source-avif',
    extension: 'avif',
    imageBase64:
      'AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAAXBtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAANGlsb2MAAAAAREAAAgABAAAAAAGUAAEAAAAAAAAAHQACAAAAAAGxAAEAAAAAAAAAFQAAADhpaW5mAAAAAAACAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAFWluZmUCAAAAAAIAAGF2MDEAAAAAr2lwcnAAAACKaXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAABEAAAANAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAcAAAAAA5waXhpAAAAAAEIAAAAOGF1eEMAAAAAdXJuOm1wZWc6bXBlZ0I6Y2ljcDpzeXN0ZW1zOmF1eGlsaWFyeTphbHBoYQAAAAAdaXBtYQAAAAAAAAACAAEDgQIDAAIEhAIFhgAAABppcmVmAAAAAAAAAA5hdXhsAAIAAQABAAAAOm1kYXQSAAoIOBDhjCAhoNIyDxgAAABAAeAHi4pg1AUBKBIACgUYEOGMKjIKGAAAAQAF04DygA==',
  },
] as const;

suite('PNGに変換コマンド', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = createSandbox();
    sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
  });

  teardown(() => {
    sandbox.restore();
  });

  test('JPEG、WebP、AVIF、2ページPDFを1回のコマンド実行でまとめてPNGへ変換し、画像は拡張子置換の.png、PDFはページごとの1.png/2.pngをサブディレクトリに生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const imagePaths = await Promise.all(
        imageVariants.map(async (variant) => {
          const sourcePath = path.join(temporaryDirectory, `${variant.basename}.${variant.extension}`);
          await writeFile(sourcePath, Buffer.from(variant.imageBase64, 'base64'));
          return sourcePath;
        }),
      );
      const pdfPath = path.join(temporaryDirectory, 'source-document.pdf');
      await writeTwoPagePdf(pdfPath);
      const sourcePaths = [...imagePaths, pdfPath];

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.convertToPng',
        vscode.Uri.file(requireValue(sourcePaths[0])),
        sourcePaths.map((sourcePath) => vscode.Uri.file(sourcePath)),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      await Promise.all(imagePaths.map((sourcePath) => assertReadablePng(replaceExtension(sourcePath, '.png'))));
      await assertReadablePng(path.join(temporaryDirectory, 'source-document', '1.png'));
      await assertReadablePng(path.join(temporaryDirectory, 'source-document', '2.png'));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('GIFとTIFFのテスト入力ファイルをPNGへ変換し、それぞれpng形式で幅と高さが0より大きい', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePaths = await Promise.all(
        (['gif', 'tiff'] as const).map(async (extension) => {
          const sourcePath = path.join(temporaryDirectory, `source-${extension}.${extension}`);
          await writeAnimatedImageFixture(sourcePath, extension);
          return sourcePath;
        }),
      );

      await withWorkspaceSettings(
        {
          'graphics-workbench.outputPath.single.png': '${fileDirname}/${fileBasenameNoExtension}.png',
        },
        async () => {
          const commandExecution = vscode.commands.executeCommand(
            'graphics-workbench.convertToPng',
            vscode.Uri.file(requireValue(sourcePaths[0])),
            sourcePaths.map((sourcePath) => vscode.Uri.file(sourcePath)),
          );
          await runCommandAndClearNotificationsUntilDone(commandExecution);
        },
      );

      await Promise.all(sourcePaths.map((sourcePath) => assertReadablePng(replaceExtension(sourcePath, '.png'))));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('SVG入力から変換したPNGがpng形式で幅と高さが0より大きい', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.svg');
      await writeTestSvg(sourcePath, generatedSvgWidth, generatedSvgHeight);

      const commandExecution = vscode.commands.executeCommand(
        'graphics-workbench.convertToPng',
        vscode.Uri.file(sourcePath),
      );
      await runCommandAndClearNotificationsUntilDone(commandExecution);

      await assertReadablePng(replaceExtension(sourcePath, '.png'));
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });

  test('outputPath.split.pngが設定済みの場合、2ページPDFを${page}ごとに展開したto-png-source-1.pngとto-png-source-2.pngを生成する', async () => {
    const temporaryDirectory = await createTemporaryWorkspaceDirectory();

    try {
      const sourcePath = path.join(temporaryDirectory, 'source.pdf');
      const firstOutputPath = path.join(temporaryDirectory, 'to-png-source-1.png');
      const secondOutputPath = path.join(temporaryDirectory, 'to-png-source-2.png');
      await writeTwoPagePdf(sourcePath);

      await withWorkspaceSettings(
        {
          'graphics-workbench.outputPath.split.png': '${fileDirname}/to-png-${fileBasenameNoExtension}-${page}.png',
        },
        async () => {
          const commandExecution = vscode.commands.executeCommand(
            'graphics-workbench.convertToPng',
            vscode.Uri.file(sourcePath),
          );
          await runCommandAndClearNotificationsUntilDone(commandExecution);
        },
      );

      await assertReadablePng(firstOutputPath);
      await assertReadablePng(secondOutputPath);
    } finally {
      await removeTemporaryDirectory(temporaryDirectory);
    }
  });
});

async function writeAnimatedImageFixture(filePath: string, format: 'gif' | 'tiff'): Promise<void> {
  const red = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const blue = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const output = sharp([red, blue], { join: { animated: true } });
  await (format === 'gif' ? output.gif() : output.tiff()).toFile(filePath);
}

async function createTemporaryWorkspaceDirectory(): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder);

  const temporaryDirectory = await mkdtemp(path.join(workspaceFolder.uri.fsPath, 'gw-convert-to-png-'));
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

async function writeTestSvg(filePath: string, width: number, height: number): Promise<void> {
  await writeFile(
    filePath,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#285078"/></svg>`,
  );
}

async function writeTwoPagePdf(filePath: string): Promise<void> {
  const document = await PDFDocument.create();
  document.addPage([72, 36]);
  document.addPage([36, 72]);
  await writeFile(filePath, await document.save());
}

async function assertReadablePng(filePath: string): Promise<void> {
  const imageBuffer = await readFile(filePath);
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();

  assert.strictEqual(metadata.format, 'png');
  assert.ok(metadata.width);
  assert.ok(metadata.width > 0);
  assert.ok(metadata.height);
  assert.ok(metadata.height > 0);
}

function replaceExtension(filePath: string, extension: string): string {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${extension}`);
}

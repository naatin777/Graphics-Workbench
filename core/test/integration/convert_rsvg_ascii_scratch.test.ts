// Test target:
// - WindowsのSVG→PDF routeがUnicode論理入力をASCII scratchへcopyしてrsvg-convert相当runnerへ渡すこと
// - rsvg-convert相当runnerの出力を論理outputPathへ反映すること
// - 期待pathと異なる別名出力や0 byte出力を成功扱いしないこと
//
// Mocked:
// - rsvg-convertのprocess実行とPDF出力
// - Windows platformとscratch base候補
//
// Not tested:
// - rsvg-convert実体のWindows path互換性（GitHub Actionsの実体経路で別に確認する）
// - Puppeteer engine、PDF renderer、Ghostscript、Draw.io、Safe Mode、UI操作

import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtempDisposable, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { operationSvgInputPath, operationPdfInputDirectory, readPdfPages } from '@graphics-workbench/core/testing';
import { Result } from 'better-result';

import {
  convertToPdfFiles,
  type ConvertToPdfFilesOptions,
  type SvgToPdfBackend,
} from '@graphics-workbench/core/conversion';

const svgTestDataPath = operationSvgInputPath;
const pdfTestDataPath = path.join(operationPdfInputDirectory, 'multilingual-text.pdf');
const complexSourceFileName =
  '　日本語 English 한국어 中文 العربية हिन्दी ไทย עברית Ελληνικά Русский 🌹 ＡＢＣ１２３①.svg';
const complexOutputFileName = '結果 한국어 العربية हिन्दी ไทย עברית Ελληνικά Русский 🌹　ＡＢＣ①.pdf';

interface WindowsScratchOptions {
  platform: NodeJS.Platform;
  scratchBaseCandidates: readonly string[];
}

type RunRsvgConvert = SvgToPdfBackend['runRsvgConvert'];

interface RsvgToPdfOptions extends SvgToPdfBackend {
  runRsvgConvert: RunRsvgConvert;
}

type ConvertToPdfFilesWithScratch = (
  options: ConvertToPdfFilesOptions &
    WindowsScratchOptions & {
      tools: { svgToPdfTools: RsvgToPdfOptions };
    },
) => ReturnType<typeof convertToPdfFiles>;

// Implementation Phaseで追加するplatform・scratch・runnerの注入契約を、失敗テストでも型安全に呼ぶ。
const convertToPdfFilesWithScratch = convertToPdfFiles as ConvertToPdfFilesWithScratch;

interface FixedTestDataWorkspace {
  testRootPath: string;
  workspacePath: string;
  scratchBasePath: string;
  sourcePath: string;
  outputPath: string;
}

describe('Windowsでrsvg-convertへUnicode入力をASCIIのみの一時作業ディレクトリ（スクラッチ）経由で渡してPDFへ変換する', () => {
  it('Unicodeの論理pathを維持したまま、ASCIIスクラッチ上のinput.svg/output.pdfへrsvg-convertを実行してPDFへ変換し、成功後にスクラッチの両ファイルを削除する', async () => {
    await using paths = await prepareFixedTestDataWorkspace();
    let toolInputPath: string | undefined;
    let toolOutputPath: string | undefined;

    const sourceBytes = await readFile(paths.sourcePath);
    const pdfBytes = await readFile(pdfTestDataPath);

    await convertToPdfFilesWithScratch({
      inputs: [createItem(paths)],
      tools: {
        svgToPdfTools: createSvgToPdfOptions(async (executable, args) => {
          toolInputPath = assertRsvgToolPaths(executable, args, paths);
          toolOutputPath = outputPathFromArgs(args);
          assert.deepStrictEqual(await readFile(toolInputPath), sourceBytes);
          await writeFile(toolOutputPath, pdfBytes);
          return Result.ok();
        }),
      },
      platform: 'win32',
      scratchBaseCandidates: [paths.scratchBasePath],
      runId: 'windows-rsvg-pdf',
      maxInputPixels: 1_000_000_000,
      runtime: {},
    });

    const requiredInputPath = requiredPath(toolInputPath, 'tool入力path');
    const requiredOutputPath = requiredPath(toolOutputPath, 'tool出力path');
    await assertReadablePdf(paths.outputPath);
    assert.deepStrictEqual(await readFile(paths.sourcePath), sourceBytes);
    await assertFileDoesNotExist(requiredInputPath);
    await assertFileDoesNotExist(requiredOutputPath);
  });

  it('rsvg-convertが期待した出力pathと異なる別名PDFを書き出した場合は成功扱いせず、論理出力PDFを作らずにエラーにする', async () => {
    await using paths = await prepareFixedTestDataWorkspace();
    let unexpectedOutputPath: string | undefined;

    await assert.rejects(
      convertToPdfFilesWithScratch({
        inputs: [createItem(paths)],
        tools: {
          svgToPdfTools: createSvgToPdfOptions(async (_executable, args) => {
            const outputPath = outputPathFromArgs(args);
            unexpectedOutputPath = path.join(path.dirname(outputPath), 'output-garbled.pdf');
            await copyFile(pdfTestDataPath, unexpectedOutputPath);
            return Result.ok();
          }),
        },
        platform: 'win32',
        scratchBaseCandidates: [paths.scratchBasePath],
        runId: 'windows-rsvg-alias',
        maxInputPixels: 1_000_000_000,
        runtime: {},
      }),
    );

    const requiredUnexpectedPath = requiredPath(unexpectedOutputPath, '別名tool出力path');
    assert.strictEqual(isPathInside(paths.scratchBasePath, requiredUnexpectedPath), true);
    await access(requiredUnexpectedPath, constants.F_OK);
    await assertFileDoesNotExist(paths.outputPath);
  });

  it('rsvg-convertが期待した出力pathへ0 byteのPDFを書き出した場合も成功扱いせず、論理出力PDFを作らずにエラーにする', async () => {
    await using paths = await prepareFixedTestDataWorkspace();
    let toolOutputPath: string | undefined;

    await assert.rejects(
      convertToPdfFilesWithScratch({
        inputs: [createItem(paths)],
        tools: {
          svgToPdfTools: createSvgToPdfOptions(async (_executable, args) => {
            toolOutputPath = outputPathFromArgs(args);
            await writeFile(toolOutputPath, Buffer.alloc(0));
            return Result.ok();
          }),
        },
        platform: 'win32',
        scratchBaseCandidates: [paths.scratchBasePath],
        runId: 'windows-rsvg-empty',
        maxInputPixels: 1_000_000_000,
        runtime: {},
      }),
    );

    const requiredOutputPath = requiredPath(toolOutputPath, '0 byte tool出力path');
    assert.strictEqual((await stat(requiredOutputPath)).size, 0);
    await assertFileDoesNotExist(paths.outputPath);
  });
});

function createSvgToPdfOptions(runRsvgConvert: RunRsvgConvert): RsvgToPdfOptions {
  return {
    engine: 'rsvg-convert',
    rsvgConvertPath: 'rsvg-convert',
    chromePath: '',
    runRsvgConvert,
    runChrome: async () => {
      throw new Error('chrome must not run for rsvg-convert engine');
    },
  };
}

function createItem(paths: FixedTestDataWorkspace) {
  return {
    sourcePath: paths.sourcePath,
    outputPath: paths.outputPath,
    workspacePath: paths.workspacePath,
  };
}

function assertRsvgToolPaths(executable: string, args: string[], paths: FixedTestDataWorkspace): string {
  assert.strictEqual(executable, 'rsvg-convert');
  assert.strictEqual(args[0], '--format=pdf');
  assert.strictEqual(args[1], '--output');

  const [, , outputPath, inputPath] = args;
  assert.ok(inputPath);
  assert.ok(outputPath);
  assert.strictEqual(path.basename(inputPath), 'input.svg');
  assert.strictEqual(path.basename(outputPath), 'output.pdf');
  assert.match(inputPath, /^[\x20-\x7e]+$/u);
  assert.match(outputPath, /^[\x20-\x7e]+$/u);
  assert.strictEqual(path.dirname(inputPath), path.dirname(outputPath));
  assert.strictEqual(isPathInside(paths.scratchBasePath, inputPath), true);
  assert.strictEqual(isPathInside(paths.scratchBasePath, outputPath), true);
  assert.strictEqual(isPathInside(paths.workspacePath, inputPath), false);
  assert.strictEqual(isPathInside(paths.workspacePath, outputPath), false);

  return inputPath;
}

function outputPathFromArgs(args: string[]): string {
  const [, , outputPath] = args;
  assert.ok(outputPath);
  return outputPath;
}

async function prepareFixedTestDataWorkspace(): Promise<FixedTestDataWorkspace & AsyncDisposable> {
  const disposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rsvg-scratch-test-'));
  const testRootPath = disposable.path;
  const workspacePath = path.join(testRootPath, 'workspace 日本語 हिन्दी 🌹');
  const scratchBasePath = path.join(testRootPath, 'scratch');
  const sourcePath = path.join(workspacePath, complexSourceFileName);
  const outputPath = path.join(workspacePath, complexOutputFileName);

  await Promise.all([mkdir(workspacePath, { recursive: true }), mkdir(scratchBasePath, { recursive: true })]);
  await copyFile(svgTestDataPath, sourcePath);

  return {
    testRootPath,
    workspacePath,
    scratchBasePath: await realpath(scratchBasePath),
    sourcePath,
    outputPath,
    [Symbol.asyncDispose]: () => disposable[Symbol.asyncDispose](),
  };
}

async function assertReadablePdf(filePath: string): Promise<void> {
  const bytes = await readFile(filePath);
  assert.ok(bytes.length > 0);
  const pages = await readPdfPages(bytes);
  assert.ok(pages.length > 0);
}

function requiredPath(filePath: string | undefined, label: string): string {
  assert.ok(filePath, `${label}が記録されること`);
  return filePath;
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath === '' ||
    (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))
  );
}

async function assertFileDoesNotExist(filePath: string): Promise<void> {
  await assert.rejects(access(filePath, constants.F_OK), (error) => {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  });
}

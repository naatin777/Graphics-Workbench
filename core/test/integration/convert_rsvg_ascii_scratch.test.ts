// Test target:
// - WindowsのSVG→PDF routeがUnicode論理入力をASCII scratchへcopyしてrsvg-convert相当runnerへ渡すこと
// - rsvg-convert相当runnerの出力を論理outputPathへ反映すること
// - 期待pathと異なる別名出力や0 byte出力を成功扱いしないこと
//
// Mocked:
// - rsvg-convertのprocess実行とPDF出力（configuration.svgToPdf.rsvgConvertPathへ渡す実行可能スクリプト）
// - Windows platformとASCIIなscratch base（TMPDIR）
//
// Not tested:
// - rsvg-convert実体のWindows path互換性（GitHub Actionsの実体経路で別に確認する）
// - Puppeteer engine、PDF renderer、Ghostscript、Draw.io、Safe Mode、UI操作

import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtempDisposable,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  convertSinglePdf,
  type ConversionConfiguration,
  type ConversionResult,
} from '@graphics-workbench/core/conversion';
import {
  createTestRuntime,
  operationPdfInputDirectory,
  operationSvgInputPath,
  readPdfPages,
  testConversionConfiguration,
  type TestRuntime,
} from '@graphics-workbench/core/testing';

const svgTestDataPath = operationSvgInputPath;
const pdfTestDataPath = path.join(operationPdfInputDirectory, 'multilingual-text.pdf');
const complexSourceFileName =
  '　日本語 English 한국어 中文 العربية हिन्दी ไทย עברית Ελληνικά Русский 🌹 ＡＢＣ１２３①.svg';
const complexOutputFileName = '結果 한국어 العربية हिन्दी ไทย עברית Ελληνικά Русский 🌹　ＡＢＣ①.pdf';

interface FixedTestDataWorkspace {
  testRootPath: string;
  workspacePath: string;
  sourcePath: string;
  outputPath: string;
}

type FakeRsvgBehavior = 'success' | 'alias' | 'empty';

describe('Windowsでrsvg-convertへUnicode入力をASCIIのみの一時作業ディレクトリ（スクラッチ）経由で渡してPDFへ変換する', () => {
  it('Unicodeの論理pathを維持したまま、ASCIIスクラッチ上のinput.svg/output.pdfへrsvg-convertを実行してPDFへ変換し、成功後にスクラッチの両ファイルを削除する', async () => {
    await withAsciiScratchTmpDir(async (testRootPath) => {
      const paths = await prepareFixedTestDataWorkspace(testRootPath);
      const { result, testRuntime } = await runFakeRsvgConversion(testRootPath, paths, 'success');

      assert.ok(result.isOk(), `conversion failed: ${result.isErr() ? result.error.message : ''}`);
      const toolInputPath = requiredPath(scratchedLine(testRuntime.output.lines, 'tool input:'), 'tool入力path');
      const toolOutputPath = requiredPath(scratchedLine(testRuntime.output.lines, 'tool output:'), 'tool出力path');
      assert.match(toolInputPath, /^[\x20-\x7e]+$/u);
      assert.match(toolOutputPath, /^[\x20-\x7e]+$/u);
      assert.strictEqual(path.basename(toolInputPath), 'input.svg');
      assert.strictEqual(path.basename(toolOutputPath), 'output.pdf');
      assert.strictEqual(isPathInside(paths.workspacePath, toolInputPath), false);
      assert.strictEqual(isPathInside(paths.workspacePath, toolOutputPath), false);

      const sourceBytes = await readFile(paths.sourcePath);
      await assertReadablePdf(paths.outputPath);
      assert.deepStrictEqual(await readFile(paths.sourcePath), sourceBytes);
      await assertFileDoesNotExist(toolInputPath);
      await assertFileDoesNotExist(toolOutputPath);
    });
  });

  it('rsvg-convertが期待した出力pathと異なる別名PDFを書き出した場合は成功扱いせず、論理出力PDFを作らずにエラーにする', async () => {
    await withAsciiScratchTmpDir(async (testRootPath) => {
      const paths = await prepareFixedTestDataWorkspace(testRootPath);
      const { result, testRuntime } = await runFakeRsvgConversion(testRootPath, paths, 'alias');

      assert.ok(result.isErr(), 'alias output should not be treated as success');
      const retainedRoot = requiredPath(
        scratchedLine(testRuntime.output.lines, 'retained after failure:'),
        'scratch root',
      );
      const unexpectedOutputPath = path.join(retainedRoot, 'output-garbled.pdf');
      await access(unexpectedOutputPath, constants.F_OK);
      await assertFileDoesNotExist(paths.outputPath);
    });
  });

  it('rsvg-convertが期待した出力pathへ0 byteのPDFを書き出した場合も成功扱いせず、論理出力PDFを作らずにエラーにする', async () => {
    await withAsciiScratchTmpDir(async (testRootPath) => {
      const paths = await prepareFixedTestDataWorkspace(testRootPath);
      const { result, testRuntime } = await runFakeRsvgConversion(testRootPath, paths, 'empty');

      assert.ok(result.isErr(), '0 byte output should not be treated as success');
      const toolOutputPath = requiredPath(scratchedLine(testRuntime.output.lines, 'tool output:'), 'tool出力path');
      assert.strictEqual((await stat(toolOutputPath)).size, 0);
      await assertFileDoesNotExist(paths.outputPath);
    });
  });
});

async function runFakeRsvgConversion(
  testRootPath: string,
  paths: FixedTestDataWorkspace,
  behavior: FakeRsvgBehavior,
): Promise<{ result: ConversionResult; testRuntime: TestRuntime }> {
  const fakeRsvgPath = await writeFakeRsvgConvert(testRootPath);
  await writeFile(path.join(testRootPath, 'fake-rsvg-output.pdf'), await readFile(pdfTestDataPath));
  const restoreEnvironment = setFakeRsvgEnvironment(testRootPath, behavior);
  const testRuntime = createTestRuntime();
  try {
    const result = await convertSinglePdf(
      [
        {
          sourcePath: paths.sourcePath,
          workspacePath: paths.workspacePath,
          workspaceName: path.basename(paths.workspacePath),
        },
      ],
      `\${fileDirname}/${complexOutputFileName}`,
      windowsRsvgConfiguration(fakeRsvgPath),
      testRuntime.runtime,
    );
    return { result, testRuntime };
  } finally {
    restoreEnvironment();
  }
}

function windowsRsvgConfiguration(fakeRsvgPath: string): ConversionConfiguration {
  return testConversionConfiguration({
    maxInputPixels: 1_000_000_000,
    platform: 'win32',
    svgToPdf: {
      engine: 'rsvg-convert',
      rsvgConvertPath: fakeRsvgPath,
      chromePath: '',
    },
  });
}

/** TMPDIRをsymlinkを含まないASCII絶対pathへ差し替えて、Windows scratch生成をmacOSでも可能にする。 */
async function withAsciiScratchTmpDir<R>(callback: (testRootPath: string) => Promise<R>): Promise<R> {
  const previousTmpDir = process.env.TMPDIR;
  const disposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-rsvg-ascii-base-'));
  const realBasePath = await realpath(disposable.path);
  process.env.TMPDIR = realBasePath;
  try {
    return await callback(realBasePath);
  } finally {
    if (previousTmpDir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previousTmpDir;
    }
    await disposable[Symbol.asyncDispose]();
  }
}

const fakeRsvgScript = [
  '#!/bin/sh',
  'output=""',
  'prev=""',
  'for arg in "$@"; do',
  '  if [ "$prev" = "--output" ]; then',
  '    output="$arg"',
  '  fi',
  '  prev="$arg"',
  'done',
  '[ -n "$output" ] || exit 1',
  'if [ -n "$FAKE_RSVG_EMPTY" ]; then',
  '  : > "$output"',
  '  exit 0',
  'fi',
  'if [ -n "$FAKE_RSVG_ALIAS" ]; then',
  '  cp "$FAKE_RSVG_PDF" "$(dirname "$output")/output-garbled.pdf"',
  '  exit 0',
  'fi',
  'if [ -n "$FAKE_RSVG_PDF" ] && [ -f "$FAKE_RSVG_PDF" ]; then',
  '  cp "$FAKE_RSVG_PDF" "$output"',
  '  exit 0',
  'fi',
  'exit 1',
  '',
].join('\n');

async function writeFakeRsvgConvert(testRootPath: string): Promise<string> {
  const fakeRsvgPath = path.join(testRootPath, 'fake-rsvg-convert.sh');
  await writeFile(fakeRsvgPath, fakeRsvgScript);
  await chmod(fakeRsvgPath, 0o755);
  return fakeRsvgPath;
}

function setFakeRsvgEnvironment(testRootPath: string, behavior: FakeRsvgBehavior): () => void {
  const previousFakePdf = process.env.FAKE_RSVG_PDF;
  const previousAlias = process.env.FAKE_RSVG_ALIAS;
  const previousEmpty = process.env.FAKE_RSVG_EMPTY;
  process.env.FAKE_RSVG_PDF = path.join(testRootPath, 'fake-rsvg-output.pdf');
  if (behavior === 'alias') {
    process.env.FAKE_RSVG_ALIAS = '1';
  } else {
    delete process.env.FAKE_RSVG_ALIAS;
  }
  if (behavior === 'empty') {
    process.env.FAKE_RSVG_EMPTY = '1';
  } else {
    delete process.env.FAKE_RSVG_EMPTY;
  }
  return () => {
    if (previousFakePdf === undefined) {
      delete process.env.FAKE_RSVG_PDF;
    } else {
      process.env.FAKE_RSVG_PDF = previousFakePdf;
    }
    if (previousAlias === undefined) {
      delete process.env.FAKE_RSVG_ALIAS;
    } else {
      process.env.FAKE_RSVG_ALIAS = previousAlias;
    }
    if (previousEmpty === undefined) {
      delete process.env.FAKE_RSVG_EMPTY;
    } else {
      process.env.FAKE_RSVG_EMPTY = previousEmpty;
    }
  };
}

function scratchedLine(lines: readonly string[], suffix: string): string | undefined {
  for (const line of lines) {
    if (line.includes(suffix)) {
      return line.slice(line.indexOf(suffix) + suffix.length).trim();
    }
  }
  return undefined;
}

async function prepareFixedTestDataWorkspace(testRootPath: string): Promise<FixedTestDataWorkspace> {
  const workspacePath = path.join(testRootPath, 'workspace 日本語 हिन्दी 🌹');
  const sourcePath = path.join(workspacePath, complexSourceFileName);
  const outputPath = path.join(workspacePath, complexOutputFileName);

  await mkdir(workspacePath, { recursive: true });
  await copyFile(svgTestDataPath, sourcePath);

  return {
    testRootPath,
    workspacePath,
    sourcePath,
    outputPath,
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

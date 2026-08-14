import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { cropPdfFile, type CropPdfFileWriter } from '@graphics-workbench/core/pdf';
import {
  invalidPreflightInputDirectory,
  operationPdfInputDirectory,
  readPdfPages,
} from '@graphics-workbench/core/testing';

const multilingualFixturePath = path.join(operationPdfInputDirectory, 'multilingual-text.pdf');
const mixedContentFixturePath = path.join(operationPdfInputDirectory, 'multi-page-mixed-content.pdf');
const brokenFixturePath = path.join(invalidPreflightInputDirectory, 'not-a-pdf.pdf');

// mupdf re-serializes page boxes with limited float precision, so compare
// against the source within a small tolerance instead of exact equality.
function assertBoxEquals(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
  tolerance = 0.001,
): void {
  assert.ok(Math.abs(actual.x - expected.x) <= tolerance, `x differs: ${actual.x} vs ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= tolerance, `y differs: ${actual.y} vs ${expected.y}`);
  assert.ok(
    Math.abs(actual.width - expected.width) <= tolerance,
    `width differs: ${actual.width} vs ${expected.width}`,
  );
  assert.ok(
    Math.abs(actual.height - expected.height) <= tolerance,
    `height differs: ${actual.height} vs ${expected.height}`,
  );
}

describe('PDFのCropBox更新', () => {
  it('全ページCropでは各ページのCropBoxだけを更新してMediaBoxを維持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-crop-operation-'));
    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const stagedOutputPath = path.join(workspacePath.path, 'staging', 'result.pdf');
    await mkdir(path.dirname(stagedOutputPath), { recursive: true });
    await copyFile(multilingualFixturePath, sourcePath);

    const cropBox = { left: 20, bottom: 30, right: 200, top: 280 };
    await cropPdfFile({ sourcePath, stagedOutputPath, cropBox, target: { type: 'all' } });

    const sourcePages = await readPdfPages(await readFile(sourcePath));
    const outputPages = await readPdfPages(await readFile(stagedOutputPath));
    assert.strictEqual(outputPages.length, sourcePages.length);
    for (const [index, page] of outputPages.entries()) {
      const sourcePage = sourcePages[index];
      assertBoxEquals(page.mediaBox, sourcePage?.mediaBox ?? { x: 0, y: 0, width: 0, height: 0 });
      assertBoxEquals(page.cropBox, {
        x: cropBox.left,
        y: cropBox.bottom,
        width: cropBox.right - cropBox.left,
        height: cropBox.top - cropBox.bottom,
      });
    }
  });

  it('選択ページだけのCropでは対象外ページのCropBoxと全ページのMediaBoxを維持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-crop-selected-'));
    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const stagedOutputPath = path.join(workspacePath.path, 'staging', 'result.pdf');
    await mkdir(path.dirname(stagedOutputPath), { recursive: true });
    await copyFile(mixedContentFixturePath, sourcePath);

    const cropBox = { left: 10, bottom: 10, right: 200, top: 200 };
    await cropPdfFile({
      sourcePath,
      stagedOutputPath,
      cropBox,
      target: { type: 'selected', pages: [1] },
    });

    const sourcePages = await readPdfPages(await readFile(sourcePath));
    const outputPages = await readPdfPages(await readFile(stagedOutputPath));
    assert.strictEqual(outputPages.length, sourcePages.length);
    for (const [index, page] of outputPages.entries()) {
      const sourcePage = sourcePages[index];
      assertBoxEquals(page.mediaBox, sourcePage?.mediaBox ?? { x: 0, y: 0, width: 0, height: 0 });
      if (index === 0) {
        assertBoxEquals(page.cropBox, {
          x: cropBox.left,
          y: cropBox.bottom,
          width: cropBox.right - cropBox.left,
          height: cropBox.top - cropBox.bottom,
        });
      } else {
        assertBoxEquals(page.cropBox, sourcePage?.cropBox ?? { x: 0, y: 0, width: 0, height: 0 });
      }
    }
  });

  it('壊れたPDFは解析エラーで失敗して出力を作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-crop-invalid-'));
    const sourcePath = path.join(workspacePath.path, 'invalid.pdf');
    const stagedOutputPath = path.join(workspacePath.path, 'staging', 'result.pdf');
    await mkdir(path.dirname(stagedOutputPath), { recursive: true });
    await copyFile(brokenFixturePath, sourcePath);

    await assert.rejects(
      cropPdfFile({
        sourcePath,
        stagedOutputPath,
        cropBox: { left: 1, bottom: 1, right: 100, top: 100 },
        target: { type: 'all' },
      }),
      /Failed to parse PDF/iu,
    );
    assert.strictEqual(await pathExists(stagedOutputPath), false);
    assert.strictEqual(await pathExists(`${stagedOutputPath}.partial`), false);
  });

  it('存在しない入力ファイルはENOENTで失敗して出力を作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-crop-missing-'));
    const sourcePath = path.join(workspacePath.path, 'missing.pdf');
    const stagedOutputPath = path.join(workspacePath.path, 'staging', 'result.pdf');
    await mkdir(path.dirname(stagedOutputPath), { recursive: true });

    await assert.rejects(
      cropPdfFile({
        sourcePath,
        stagedOutputPath,
        cropBox: { left: 1, bottom: 1, right: 100, top: 100 },
        target: { type: 'all' },
      }),
      /ENOENT|no such file|not found/iu,
    );
    assert.strictEqual(await pathExists(stagedOutputPath), false);
    assert.strictEqual(await pathExists(`${stagedOutputPath}.partial`), false);
  });

  it('出力先pathが既存directoryの場合はrenameに失敗して.partialを残さない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-crop-rename-'));
    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const stagedOutputPath = path.join(workspacePath.path, 'staging', 'result.pdf');
    await mkdir(path.dirname(stagedOutputPath), { recursive: true });
    await copyFile(multilingualFixturePath, sourcePath);
    await mkdir(stagedOutputPath);

    await assert.rejects(
      cropPdfFile({
        sourcePath,
        stagedOutputPath,
        cropBox: { left: 20, bottom: 30, right: 200, top: 280 },
        target: { type: 'all' },
      }),
      /EISDIR|directory|rename/iu,
    );
    assert.strictEqual(await pathExists(`${stagedOutputPath}.partial`), false);
  });

  it('writeFileがENOSPCで失敗するとrenameせず.partialを削除して失敗する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-crop-enospc-'));
    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const stagedOutputPath = path.join(workspacePath.path, 'staging', 'result.pdf');
    await mkdir(path.dirname(stagedOutputPath), { recursive: true });
    await copyFile(multilingualFixturePath, sourcePath);
    const removedPaths: string[] = [];
    let renameCalled = false;
    const writer: CropPdfFileWriter = {
      writeFile: async () => {
        throw new Error('No space left on device');
      },
      rename: async () => {
        renameCalled = true;
      },
      remove: async (filePath) => {
        removedPaths.push(filePath);
      },
    };

    await assert.rejects(
      cropPdfFile(
        {
          sourcePath,
          stagedOutputPath,
          cropBox: { left: 20, bottom: 30, right: 200, top: 280 },
          target: { type: 'all' },
        },
        writer,
      ),
      /No space left on device/iu,
    );
    assert.strictEqual(renameCalled, false);
    assert.deepStrictEqual(removedPaths, [`${stagedOutputPath}.partial`]);
    assert.strictEqual(await pathExists(stagedOutputPath), false);
  });
});

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

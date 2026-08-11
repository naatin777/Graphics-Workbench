import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { excalidrawToSvg, normalizeExcalidrawSvg } from '../../vscode/src/operations/conversion/excalidraw_adapter.js';
import { ExcalidrawError } from '../../vscode/src/operations/conversion/excalidraw_scene.js';
import { testInputDirectory } from '../helpers/fixture_paths.js';

const projectRootDirectory = path.dirname(path.dirname(testInputDirectory));
const excalidrawBundlePath = path.join(projectRootDirectory, 'media', 'excalidraw', 'excalidraw-adapter.mjs');

function validFixture(name: string): string {
  return path.join(testInputDirectory, 'valid', 'excalidraw', name);
}

function rejectsWithCategory(category: string): (error: unknown) => boolean {
  return (error) => error instanceof ExcalidrawError && error.category === category;
}

suite('Excalidraw sceneからSVGを生成する処理', () => {
  test('重複したxmlns属性を持つSVG文字列をnormalizeExcalidrawSvgで正規化するとxmlnsが1つにまとまり、再適用しても結果が変わらない', () => {
    const duplicated =
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';
    const normalized = normalizeExcalidrawSvg(duplicated);
    assert.strictEqual(normalized.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/gu)?.length, 1);
    assert.ok(normalized.startsWith('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox='));
    assert.strictEqual(normalized, normalizeExcalidrawSvg(normalized));
  });

  test('filesに存在しないfileIdを参照するimage要素を含むsceneを変換すると、embedded-imageカテゴリのエラーとして失敗する', async () => {
    await withTempSvgOutput(async (svgPath) => {
      const sourcePath = await writeTempScene(
        JSON.stringify({
          type: 'excalidraw',
          elements: [{ type: 'image', fileId: 'missing' }],
          files: {},
        }),
      );
      await assert.rejects(
        excalidrawToSvg({ sourcePath, svgPath, loadExportToSvg: fakeLoadExportToSvg() }),
        rejectsWithCategory('embedded-image'),
      );
    });
  });

  test('JSONとして解釈できないsceneファイルを渡すと、jsonカテゴリのエラーとして失敗する', async () => {
    await withTempSvgOutput(async (svgPath) => {
      const sourcePath = await writeTempScene('{ not json');
      await assert.rejects(
        excalidrawToSvg({ sourcePath, svgPath, loadExportToSvg: fakeLoadExportToSvg() }),
        rejectsWithCategory('json'),
      );
    });
  });

  test('存在しないパスを指すsceneファイルを渡すと、readカテゴリのエラーとして失敗する', async () => {
    await withTempSvgOutput(async (svgPath) => {
      await assert.rejects(
        excalidrawToSvg({
          sourcePath: path.join(os.tmpdir(), 'missing.excalidraw'),
          svgPath,
          loadExportToSvg: fakeLoadExportToSvg(),
        }),
        rejectsWithCategory('read'),
      );
    });
  });

  test('読み込んだsceneをexportToSvgのoptions（elements・viewBackgroundColor・exportPadding=10）へ渡してSVGを生成し、正規化したSVGを出力ファイルへ書き出す', async () => {
    const capturedOptions: Record<string, unknown>[] = [];
    const loadExportToSvg = async () => ({
      exportToSvg: async (options: Record<string, unknown>) => {
        capturedOptions.push(options);
        return createSvgElement('200', '100', '12');
      },
    });

    await withTempSvgOutput(async (svgPath) => {
      const sourcePath = await writeTempScene(
        JSON.stringify({
          type: 'excalidraw',
          version: 2,
          elements: [{ type: 'rectangle', id: 'r1' }],
          appState: { viewBackgroundColor: '#ffffff' },
          files: {},
        }),
      );
      await excalidrawToSvg({ sourcePath, svgPath, loadExportToSvg });

      const svg = await readFile(svgPath, 'utf8');
      assert.ok(/<svg[\s>]/u.test(svg));
      assert.ok(/<rect[\s>]/u.test(svg));
      assert.strictEqual(svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/gu)?.length, 1);

      const [options] = capturedOptions;
      assert.ok(options !== undefined);
      const { elements } = options;
      assert.ok(Array.isArray(elements));
      assert.strictEqual(elements.length, 1);
      const { appState } = options;
      assert.ok(typeof appState === 'object' && appState !== null && 'viewBackgroundColor' in appState);
      assert.strictEqual(appState.viewBackgroundColor, '#ffffff');
      assert.strictEqual(options.exportPadding, 10);
    });
  });

  test('exportToSvgが失敗すると、exportカテゴリのエラーとして失敗する', async () => {
    const loadExportToSvg = async () => ({
      exportToSvg: async () => {
        throw new Error('boom');
      },
    });

    await withTempSvgOutput(async (svgPath) => {
      const sourcePath = await writeTempScene('{"type":"excalidraw","elements":[]}');
      await assert.rejects(excalidrawToSvg({ sourcePath, svgPath, loadExportToSvg }), rejectsWithCategory('export'));
    });
  });

  test('実excalidraw-adapter.mjs bundleでbackground-color fixtureをSVGへ変換し、svg・rect要素と正のviewBox・埋め込み@font-faceを含むSVGを生成する', async function realBundleExport() {
    if (!existsSync(excalidrawBundlePath)) {
      this.skip();
      return;
    }

    await withTempSvgOutput(async (svgPath) => {
      await excalidrawToSvg({
        sourcePath: validFixture('background-color.excalidraw'),
        svgPath,
        bundleUrl: pathToFileURL(excalidrawBundlePath).href,
      });

      const svg = await readFile(svgPath, 'utf8');
      assert.ok(/<svg[\s>]/u.test(svg));
      assert.ok(/<rect[\s>]/u.test(svg));
      const viewBox = svg.match(/viewBox="([^"]+)"/u)?.[1];
      assert.ok(viewBox !== undefined, 'SVG must declare a viewBox');
      const [width, height] = viewBox.split(' ').slice(2).map(Number);
      assert.ok((width ?? 0) > 0 && (height ?? 0) > 0, `SVG dimensions must be positive: ${viewBox}`);
      const fontFaceCount = svg.match(/@font-face/gu)?.length ?? 0;
      assert.ok(fontFaceCount > 0, 'text elements must embed a subsetted @font-face');
    });
  });
});

function fakeLoadExportToSvg() {
  return async () => ({
    exportToSvg: async () => createSvgElement('100', '100', '1'),
  });
}

function createSvgElement(width: string, height: string, rectSize: string): unknown {
  const documentGlobal = documentFromGlobal();
  const svg = documentGlobal.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const rect = documentGlobal.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', rectSize);
  rect.setAttribute('height', rectSize);
  svg.append(rect);
  return svg;
}

function documentFromGlobal(): { createElementNS: (namespaceUri: string, qualifiedName: string) => any } {
  const globalObject: object = globalThis;
  if (!('document' in globalObject)) {
    throw new Error('Expected a DOM document in the test globals.');
  }
  const documentValue = globalObject.document;
  if (typeof documentValue !== 'object' || documentValue === null || !('createElementNS' in documentValue)) {
    throw new Error('Expected a DOM document in the test globals.');
  }
  const { createElementNS } = documentValue;
  if (typeof createElementNS !== 'function') {
    throw new Error('Expected a DOM document in the test globals.');
  }
  return {
    createElementNS: (namespaceUri, qualifiedName) => createElementNS.call(documentValue, namespaceUri, qualifiedName),
  };
}

async function writeTempScene(source: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gw-excalidraw-scene-'));
  const sourcePath = path.join(directory, 'scene.excalidraw');
  await writeFile(sourcePath, source);
  return sourcePath;
}

async function withTempSvgOutput(run: (svgPath: string) => Promise<void>): Promise<void> {
  await using directory = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-excalidraw-svg-'));
  const svgPath = path.join(directory.path, 'output.svg');
  await run(svgPath);
}

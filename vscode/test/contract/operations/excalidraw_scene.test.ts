import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ExcalidrawError, parseExcalidrawScene } from '../../../src/operations/conversion/excalidraw_scene.js';
import { testInputDirectory } from '../../support/helpers/fixture_paths.js';

function validFixture(name: string): string {
  return path.join(testInputDirectory, 'valid', 'excalidraw', name);
}

function invalidFixture(name: string): string {
  return path.join(testInputDirectory, 'invalid', 'excalidraw', name);
}

function elementType(element: unknown): string | undefined {
  if (typeof element !== 'object' || element === null || !('type' in element)) {
    return undefined;
  }
  return typeof element.type === 'string' ? element.type : undefined;
}

function throwsWithCategory(fn: () => unknown, category: string): void {
  assert.throws(fn, (error) => error instanceof ExcalidrawError && error.category === category);
}

function sceneJson(elements: unknown[], appState: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'excalidraw', version: 2, elements, appState, files: {} });
}

suite('Excalidrawファイル（elements/filesを含むJSON）の解析', () => {
  test('rectangle要素1つだけのJSONを解析すると、elementsが1要素でfilesが空のsceneを返す', () => {
    const scene = parseExcalidrawScene(
      sceneJson([
        {
          type: 'rectangle',
          id: 'rect-1',
          x: 100,
          y: 100,
          width: 200,
          height: 120,
          backgroundColor: 'transparent',
        },
      ]),
    );
    assert.strictEqual(scene.elements.length, 1);
    assert.deepStrictEqual(scene.files, {});
  });

  test('rectangleとtextの2要素からなるJSONを解析すると、要素タイプがrectangle→textの順で2要素を返す', () => {
    const scene = parseExcalidrawScene(
      sceneJson([
        { type: 'rectangle', id: 'rect-1', x: 0, y: 0, width: 10, height: 10 },
        { type: 'text', id: 'text-1', text: 'Hello', fontSize: 20 },
      ]),
    );
    assert.strictEqual(scene.elements.length, 2);
    assert.deepStrictEqual(
      scene.elements.map((element) => elementType(element)),
      ['rectangle', 'text'],
    );
  });

  test('pointsを持ったarrow要素だけのJSONを解析すると、最初の要素タイプがarrowとして返る', () => {
    const scene = parseExcalidrawScene(
      sceneJson([
        {
          type: 'arrow',
          id: 'arrow-1',
          points: [
            [0, 0],
            [10, 10],
          ],
        },
      ]),
    );
    assert.strictEqual(elementType(scene.elements[0]), 'arrow');
  });

  test('background-color fixtureを解析すると、背景色が#a5d8ffで30要素の中にrectangle/arrow/text/ellipse/diamond/frame/freedrawがすべて含まれる', async () => {
    const scene = parseExcalidrawScene(await readFile(validFixture('background-color.excalidraw'), 'utf8'));
    assert.strictEqual(scene.appState.viewBackgroundColor, '#a5d8ff');
    assert.strictEqual(scene.elements.length, 30);
    const types = new Set(scene.elements.map((element) => elementType(element)));
    for (const expected of ['rectangle', 'arrow', 'text', 'ellipse', 'diamond', 'frame', 'freedraw']) {
      assert.ok(types.has(expected), `scene must contain a ${expected} element`);
    }
  });

  test('embedded-image fixtureを解析すると、3つのimage要素のfileIdがすべてfilesに登録されている', async () => {
    const scene = parseExcalidrawScene(await readFile(validFixture('embedded-image.excalidraw'), 'utf8'));
    const imageFileIds = scene.elements
      .filter((element) => elementType(element) === 'image')
      .map((element) => {
        if (typeof element !== 'object' || element === null || !('fileId' in element)) {
          return undefined;
        }
        return typeof element.fileId === 'string' ? element.fileId : undefined;
      });
    assert.strictEqual(imageFileIds.length, 3);
    for (const fileId of imageFileIds) {
      assert.ok(fileId !== undefined && Object.hasOwn(scene.files, fileId), `file ${fileId} must be registered`);
    }
  });

  test('空のscene fixtureを解析すると、elementsが空配列として返る', async () => {
    const scene = parseExcalidrawScene(await readFile(validFixture('empty.excalidraw'), 'utf8'));
    assert.deepStrictEqual(scene.elements, []);
  });

  test('JSONとして壊れたテキストをparseすると、JSONが壊れている旨のExcalidrawErrorを投げる', async () => {
    const source = await readFile(invalidFixture('malformed-json.excalidraw'), 'utf8');
    throwsWithCategory(() => parseExcalidrawScene(source), 'json');
    throwsWithCategory(() => parseExcalidrawScene('{ not json'), 'json');
  });

  test('Excalidraw形式でないJSONをparseすると、Excalidraw形式でない旨のExcalidrawErrorを投げる', async () => {
    const source = await readFile(invalidFixture('not-a-scene.excalidraw'), 'utf8');
    throwsWithCategory(() => parseExcalidrawScene(source), 'scene');
    throwsWithCategory(() => parseExcalidrawScene('[1, 2, 3]'), 'scene');
  });

  test('elementsが配列でない、または欠落したJSONをparseすると、Excalidraw形式でない旨のExcalidrawErrorを投げる', () => {
    throwsWithCategory(() => parseExcalidrawScene('{"type":"excalidraw","elements":{}}'), 'scene');
    throwsWithCategory(() => parseExcalidrawScene('{"type":"excalidraw"}'), 'scene');
  });

  test('filesに存在しないfileIdを参照するimage要素を持つsceneをparseすると、参照imageが欠けている旨のExcalidrawErrorを投げる', () => {
    const source = JSON.stringify({
      type: 'excalidraw',
      elements: [{ type: 'image', fileId: 'missing-image' }],
      files: {},
    });
    throwsWithCategory(() => parseExcalidrawScene(source), 'embedded-image');
  });

  test('fileIdを持たないimage要素を持つsceneは、エラーにせず解析を許可する', () => {
    const source = JSON.stringify({ type: 'excalidraw', elements: [{ type: 'image' }], files: {} });
    assert.doesNotThrow(() => parseExcalidrawScene(source));
  });
});

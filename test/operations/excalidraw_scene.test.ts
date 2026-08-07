import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ExcalidrawError, parseExcalidrawScene } from '../../src/operations/conversion/excalidraw_scene.js';
import { testInputDirectory } from '../helpers/fixture_paths.js';

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

suite('Excalidraw scene解析', () => {
  test('最小のsceneを解析してelements/appState/filesを返す', () => {
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

  test('rectangle + textのsceneを解析する', () => {
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

  test('arrowを持つsceneを解析する', () => {
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

  test('複雑なbackground color sceneを解析する', async () => {
    const scene = parseExcalidrawScene(await readFile(validFixture('background-color.excalidraw'), 'utf8'));
    assert.strictEqual(scene.appState.viewBackgroundColor, '#a5d8ff');
    assert.strictEqual(scene.elements.length, 30);
    const types = new Set(scene.elements.map((element) => elementType(element)));
    for (const expected of ['rectangle', 'arrow', 'text', 'ellipse', 'diamond', 'frame', 'freedraw']) {
      assert.ok(types.has(expected), `scene must contain a ${expected} element`);
    }
  });

  test('embedded imageを持つsceneを解析する', async () => {
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

  test('空のsceneを解析する', async () => {
    const scene = parseExcalidrawScene(await readFile(validFixture('empty.excalidraw'), 'utf8'));
    assert.deepStrictEqual(scene.elements, []);
  });

  test('malformed JSONをJSONエラーとして区別する', async () => {
    const source = await readFile(invalidFixture('malformed-json.excalidraw'), 'utf8');
    throwsWithCategory(() => parseExcalidrawScene(source), 'json');
    throwsWithCategory(() => parseExcalidrawScene('{ not json'), 'json');
  });

  test('ExcalidrawではないJSONをsceneエラーとして区別する', async () => {
    const source = await readFile(invalidFixture('not-a-scene.excalidraw'), 'utf8');
    throwsWithCategory(() => parseExcalidrawScene(source), 'scene');
    throwsWithCategory(() => parseExcalidrawScene('[1, 2, 3]'), 'scene');
  });

  test('elementsが配列でないJSONを不正とする', () => {
    throwsWithCategory(() => parseExcalidrawScene('{"type":"excalidraw","elements":{}}'), 'scene');
    throwsWithCategory(() => parseExcalidrawScene('{"type":"excalidraw"}'), 'scene');
  });

  test('参照されたimageファイルが欠けたsceneを不正とする', () => {
    const source = JSON.stringify({
      type: 'excalidraw',
      elements: [{ type: 'image', fileId: 'missing-image' }],
      files: {},
    });
    throwsWithCategory(() => parseExcalidrawScene(source), 'embedded-image');
  });

  test('fileIdを持たないimage elementは許容する', () => {
    const source = JSON.stringify({ type: 'excalidraw', elements: [{ type: 'image' }], files: {} });
    assert.doesNotThrow(() => parseExcalidrawScene(source));
  });
});

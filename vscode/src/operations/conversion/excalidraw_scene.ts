import { toErrorMessage } from '@graphics-workbench/core/shared/error.js';

export type ExcalidrawErrorCategory = 'read' | 'json' | 'scene' | 'embedded-image' | 'export';

export class ExcalidrawError extends Error {
  readonly category: ExcalidrawErrorCategory;

  constructor(category: ExcalidrawErrorCategory, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExcalidrawError';
    this.category = category;
  }
}

export interface ExcalidrawScene {
  // oxlint-disable-next-line typescript/no-restricted-types -- 外部.excalidraw形式の要素配列: 要素形状は動的に決まる。
  elements: unknown[];
  // oxlint-disable-next-line typescript/no-restricted-types -- 外部.excalidraw形式のappState: バンドル固有の任意dict。
  appState: Record<string, unknown>;
  // oxlint-disable-next-line typescript/no-restricted-types -- 外部.excalidraw形式のfiles: バンドル固有の任意dict。
  files: Record<string, unknown>;
}

export function parseExcalidrawScene(source: string): ExcalidrawScene {
  // oxlint-disable-next-line typescript/no-restricted-types -- JSON.parse結果を型ガードで検証する境界。
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new ExcalidrawError('json', `The Excalidraw file is not valid JSON: ${toErrorMessage(error)}`, {
      cause: error,
    });
  }

  if (!isRecord(parsed)) {
    throw new ExcalidrawError('scene', 'The file is not an Excalidraw scene.');
  }

  const { elements } = parsed;
  if (!Array.isArray(elements)) {
    throw new ExcalidrawError('scene', 'The Excalidraw scene is missing an "elements" array.');
  }

  const appState = isRecord(parsed.appState) ? parsed.appState : {};
  const files = isRecord(parsed.files) ? parsed.files : {};
  assertEmbeddedImagesAvailable(elements, files);

  return { elements, appState, files };
}

// oxlint-disable-next-line typescript/no-restricted-types -- 外部シーンデータの要素/ファイルを検証する境界。
function assertEmbeddedImagesAvailable(elements: unknown[], files: Record<string, unknown>): void {
  for (const element of elements) {
    if (!isRecord(element) || element.type !== 'image') {
      continue;
    }

    const { fileId } = element;
    if (typeof fileId !== 'string' || fileId === '') {
      continue;
    }

    const file = files[fileId];
    if (!isRecord(file) || typeof file.dataURL !== 'string' || !file.dataURL.startsWith('data:')) {
      throw new ExcalidrawError(
        'embedded-image',
        `Embedded image "${fileId}" is missing from the Excalidraw scene files.`,
      );
    }
  }
}

// oxlint-disable-next-line typescript/no-restricted-types -- 型ガード: 外部JSON値がオブジェクトか検証する。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

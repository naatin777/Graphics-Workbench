import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { projectRootDirectory } from '../support/helpers/testdata_paths.js';

interface MenuEntry {
  command?: string;
  submenu?: string;
  when?: string;
}

interface ConfigurationProperty {
  type: string | string[];
  default?: unknown;
  minLength?: number;
}

interface PackageManifest {
  activationEvents?: string[];
  contributes: {
    commands: { command: string }[];
    configuration: { properties: Record<string, ConfigurationProperty> };
    menus: Record<string, MenuEntry[]>;
    submenus: { id: string; label?: string }[];
    customEditors?: {
      viewType: string;
      displayName?: string;
      selector: { filenamePattern?: string }[];
      priority: string;
    }[];
  };
}

const CONVERT_SUBMENU = 'graphics-workbench.convert';
const CONVERSION_CATEGORY = {
  single: 'config.graphics-workbench.conversion.single.enabled',
  split: 'config.graphics-workbench.conversion.split.enabled',
  combine: 'config.graphics-workbench.conversion.combine.enabled',
} as const;

suite('公開manifestの現在のproduct invariant', () => {
  test('変換commandとDraw.ioのsingle/split menuを公開する', async () => {
    const manifest = await readManifest();
    const commandIds = new Set(manifest.contributes.commands.map(({ command }) => command));
    const convertMenu = manifest.contributes.menus[CONVERT_SUBMENU] ?? [];
    const explorerMenu = manifest.contributes.menus['explorer/context'] ?? [];
    const menuCommandIds = new Set(
      [...convertMenu, ...explorerMenu].flatMap(({ command }) => (command === undefined ? [] : [command])),
    );

    for (const command of [
      'graphics-workbench.convertToPdf',
      'graphics-workbench.convertToWebp',
      'graphics-workbench.convertToWebpSplit',
      'graphics-workbench.convertDrawioToSinglePdf',
      'graphics-workbench.convertDrawioToPagePdfs',
      'graphics-workbench.convertToDrawio',
    ]) {
      assert.ok(commandIds.has(command), `${command} must be public`);
    }
    assert.ok(menuCommandIds.has('graphics-workbench.convertDrawioToSinglePdf'));
    assert.ok(menuCommandIds.has('graphics-workbench.convertDrawioToPagePdfs'));
  });

  test('変換menuはsingle/split/combine設定を使い、animated保持とframe分割を区別する', async () => {
    const manifest = await readManifest();
    const { properties } = manifest.contributes.configuration;
    for (const category of ['single', 'split', 'combine'] as const) {
      assert.deepStrictEqual(properties[`graphics-workbench.conversion.${category}.enabled`], {
        type: 'boolean',
        default: true,
        description: `%config.conversion.${category}.enabled%`,
      });
    }

    const convertMenu = manifest.contributes.menus[CONVERT_SUBMENU] ?? [];
    const findEntry = (command: string) => convertMenu.find((entry) => entry.command === command);
    const webp = findEntry('graphics-workbench.convertToWebp');
    const webpSplit = findEntry('graphics-workbench.convertToWebpSplit');
    const combine = findEntry('graphics-workbench.combineImagesToPdf');

    assert.ok(webp?.when?.includes(CONVERSION_CATEGORY.single));
    assert.ok(webp?.when?.includes('gif'));
    assert.ok(webpSplit?.when?.includes(CONVERSION_CATEGORY.split));
    assert.ok(webpSplit?.when?.includes('resourceExtname =~ /^\\.(gif)$/i'));
    assert.ok(combine?.when?.includes(CONVERSION_CATEGORY.combine));
    assert.ok(!combine?.when?.includes(CONVERSION_CATEGORY.single));
    assert.ok(!combine?.when?.includes(CONVERSION_CATEGORY.split));
  });

  test('outputPathはcardinality別に定義され、空文字をschemaで拒否する', async () => {
    const manifest = await readManifest();
    const { properties } = manifest.contributes.configuration;
    const outputPathEntries = Object.entries(properties).filter(([key]) =>
      key.startsWith('graphics-workbench.outputPath.'),
    );

    assert.ok(outputPathEntries.length > 0);
    assert.strictEqual(
      properties['graphics-workbench.outputPath.single.drawio']?.default,
      '${fileDirname}/${fileBasenameNoExtension}.dio',
    );
    assert.strictEqual(
      properties['graphics-workbench.outputPath.split.png']?.default,
      '${fileDirname}/${fileBasenameNoExtension}/${page}.png',
    );
    assert.strictEqual(
      properties['graphics-workbench.outputPath.combine.pdf']?.default,
      '${workspaceFolder}/combined-${random}.pdf',
    );
    for (const [key, schema] of outputPathEntries) {
      assert.strictEqual(schema.minLength, 1, `${key} must reject an empty template`);
      assert.ok(!key.includes('convert'), `${key} must use the cardinality schema`);
    }
  });

  test('PDF/TIFF custom editorとLaTeX activationをmanifestで公開する', async () => {
    const manifest = await readManifest();
    const editors = manifest.contributes.customEditors ?? [];
    const pdfEditor = editors.find((editor) => editor.viewType === 'graphics-workbench.pdf.preview');
    const tiffEditor = editors.find((editor) => editor.viewType === 'graphics-workbench.tiff.preview');

    assert.strictEqual(pdfEditor?.priority, 'option');
    assert.deepStrictEqual(pdfEditor?.selector, [{ filenamePattern: '*.pdf' }]);
    assert.strictEqual(tiffEditor?.priority, 'option');
    assert.deepStrictEqual(tiffEditor?.selector, [{ filenamePattern: '*.tif' }, { filenamePattern: '*.tiff' }]);
    assert.ok(manifest.activationEvents?.includes('onLanguage:latex'));
  });
});

async function readManifest(): Promise<PackageManifest> {
  const value: unknown = JSON.parse(
    await readFile(path.join(projectRootDirectory, 'vscode', 'extension', 'package.json'), 'utf8'),
  );
  if (!isPackageManifest(value)) {
    throw new Error('package.json has an unexpected structure.');
  }
  return value;
}

function isPackageManifest(value: unknown): value is PackageManifest {
  if (typeof value !== 'object' || value === null || !('contributes' in value)) {
    return false;
  }
  const contributes: unknown = value.contributes;
  return typeof contributes === 'object' && contributes !== null;
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  commandContributions,
  publicCommandIds,
  submenuContributions,
  type SubmenuId,
} from '../../src/generated/extension_manifest.js';
import { projectRootDirectory } from '../support/helpers/fixture_paths.js';

const COMBINE_IMAGES_TO_PDF_COMMAND = 'graphics-workbench.combineImagesToPdf';
const QUICK_COMBINE_IMAGES_TO_PDF_COMMAND = 'graphics-workbench.quickCombineImagesToPdf';
const CONVERT_SUBMENU = 'graphics-workbench.convert';
const CONTEXT_MENU_ENABLED = 'config.graphics-workbench.contextMenu.enabled';
const COMPOUND_DRAWIO_MATCH = 'resourceFilename =~ /\\.(drawio|dio)\\.(png|svg)$/i';
const COMPOUND_DRAWIO_NOT_MATCH = `!(${COMPOUND_DRAWIO_MATCH})`;

/** 変換commandごとにwhen句が依存するsingle/split/combine設定。 */
const EXPECTED_CATEGORIES_BY_COMMAND: Record<string, readonly ('single' | 'split' | 'combine')[]> = {
  'graphics-workbench.convertToPdf': ['single'],
  'graphics-workbench.convertToPng': ['single', 'split'],
  'graphics-workbench.convertToJpeg': ['single', 'split'],
  'graphics-workbench.convertToWebp': ['single', 'split'],
  'graphics-workbench.convertToAvif': ['single', 'split'],
  'graphics-workbench.convertToSvg': ['single', 'split'],
  'graphics-workbench.convertToGif': ['single', 'split'],
  'graphics-workbench.convertToTiff': ['single', 'split'],
  'graphics-workbench.convertToWebpSeparately': ['split'],
  'graphics-workbench.convertToGifSeparately': ['split'],
  'graphics-workbench.convertDrawioToPagePdfs': ['split'],
  'graphics-workbench.convertDrawioToSinglePdf': ['single'],
  'graphics-workbench.convertExcalidrawToPdf': ['single'],
  'graphics-workbench.convertToDrawio': ['single'],
  'graphics-workbench.convertToDrawioPng': ['single'],
  'graphics-workbench.convertToDrawioSvg': ['single'],
  [COMBINE_IMAGES_TO_PDF_COMMAND]: ['combine'],
  [QUICK_COMBINE_IMAGES_TO_PDF_COMMAND]: ['combine'],
};

const CATEGORY_PROPERTY = {
  single: 'config.graphics-workbench.conversion.single.enabled',
  split: 'config.graphics-workbench.conversion.split.enabled',
  combine: 'config.graphics-workbench.conversion.combine.enabled',
} as const;

interface PackageJson {
  name: string;
  displayName: string;
  homepage: string;
  repository: { type: string; url: string };
  activationEvents?: string[];
  devEngines: {
    packageManager: { name: string; version: string; onFail: string };
    runtime: { name: string; version: string; onFail: string };
  };
  engines: { node?: string; vscode: string };
  contributes: {
    commands: { command: string; title: string }[];
    configuration: {
      properties: Record<
        string,
        {
          type: string | string[];
          default: unknown;
          minimum?: number;
          maximum?: number;
          minLength?: number;
          description: string;
          additionalProperties?: unknown;
          properties?: Record<string, unknown>;
        }
      >;
    };
    menus: Record<string, { command?: string; submenu?: string; when?: string }[]>;
    submenus: { id: string; label: string }[];
    customEditors?: {
      viewType: string;
      displayName: string;
      selector: { filenamePattern?: string }[];
      priority: string;
    }[];
  };
}

suite('package.jsonのruntime制約', () => {
  test('package.jsonを読み、engines.nodeを未指定にしてengines.vscodeを^1.125.0とし、開発用Node.js >=22.22.2とonFail=errorをdevEngines.runtimeで分離指定する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');

    assert.strictEqual(packageJson.engines.node, undefined);
    assert.strictEqual(packageJson.engines.vscode, '^1.125.0');
    assert.deepStrictEqual(packageJson.devEngines.runtime, {
      name: 'node',
      version: '>=22.22.2',
      onFail: 'error',
    });
  });
});

suite('package.jsonのリポジトリ情報（name・displayName・homepage・repository.url）', () => {
  test('package.jsonのname/displayNameをgraphics-workbench/Graphics Workbenchとし、homepageとrepository.urlをGitHubのリポジトリURLに一致させる', async () => {
    const packageJson = await readJson<PackageJson>('package.json');

    assert.strictEqual(packageJson.name, 'graphics-workbench');
    assert.strictEqual(packageJson.displayName, 'Graphics Workbench');
    assert.strictEqual(packageJson.homepage, 'https://github.com/naatin777/Graphics-Workbench');
    assert.deepStrictEqual(packageJson.repository, {
      type: 'git',
      url: 'https://github.com/naatin777/Graphics-Workbench',
    });
  });
});

suite('package.jsonの変換メニュー定義', () => {
  test('contributes.commandsのcommand ID一覧と生成済みpublicCommandIdsを一致させ、menuに載せたcommandがすべてpublic command一覧に含まれることを検証する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const manifestCommandIds = new Set(packageJson.contributes.commands.map((command) => command.command));
    const menuCommandIds = new Set(
      Object.values(packageJson.contributes.menus)
        .flatMap((entries) => entries.map((entry) => entry.command))
        .filter((command): command is string => command !== undefined),
    );

    assert.deepStrictEqual(new Set(publicCommandIds), manifestCommandIds);

    for (const menuCommandId of menuCommandIds) {
      assert.ok(manifestCommandIds.has(menuCommandId), `${menuCommandId} is not a public command`);
    }
  });

  test('生成済みcommandContributionsのkey一覧をcontributes.commandsと一致させ、各commandのtitleKeyと各submenuのlabelKeyがmanifestの%キー%参照と一致することを検証する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const manifestCommandIds = new Set(packageJson.contributes.commands.map((command) => command.command));

    assert.deepStrictEqual(new Set(Object.keys(commandContributions)), manifestCommandIds);
    for (const command of packageJson.contributes.commands) {
      const contribution = (commandContributions as Record<string, { titleKey: string }>)[command.command];
      assert.ok(contribution, `${command.command} is missing a contribution`);
      assert.strictEqual(contribution.titleKey, command.title?.slice(1, -1));
    }

    const manifestSubmenuIds = new Set((packageJson.contributes.submenus ?? []).map((submenu) => submenu.id));
    assert.deepStrictEqual(new Set(Object.keys(submenuContributions)), manifestSubmenuIds);
    const submenuContributionsByKey: Readonly<Record<SubmenuId, { labelKey: string }>> = submenuContributions;
    for (const submenu of packageJson.contributes.submenus ?? []) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime manifest key to generated SubmenuId
      const contribution = submenuContributionsByKey[submenu.id as SubmenuId];
      assert.ok(contribution, `${submenu.id} is missing a contribution`);
      assert.strictEqual(contribution.labelKey, submenu.label?.slice(1, -1));
    }
  });

  test('入力形式を統合したconvertToPdfコマンドを公開する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const commandIds = new Set(packageJson.contributes.commands.map((command) => command.command));

    assert.ok(commandIds.has('graphics-workbench.convertToPdf'));
  });

  test('convertDrawioToPagePdfsとconvertDrawioToSinglePdfを公開し、両方をExplorer context menuに載せる', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const commandIds = new Set(packageJson.contributes.commands.map((command) => command.command));
    const explorerContext = packageJson.contributes.menus['explorer/context'] ?? [];
    const { properties } = packageJson.contributes.configuration;

    assert.ok(commandIds.has('graphics-workbench.convertDrawioToPagePdfs'));
    assert.ok(commandIds.has('graphics-workbench.convertDrawioToSinglePdf'));
    assert.ok(explorerContext.some((entry) => entry.command === 'graphics-workbench.convertDrawioToPagePdfs'));
    assert.ok(explorerContext.some((entry) => entry.command === 'graphics-workbench.convertDrawioToSinglePdf'));
    assert.strictEqual(
      properties['graphics-workbench.outputPath.single.pdf']?.default,
      '${fileDirname}/${fileBasenameNoExtension}.pdf',
    );
  });

  test('single/split/combineの変換カテゴリ有効化設定をtype:boolean・default:true・description:%キー%で公開する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const { properties } = packageJson.contributes.configuration;

    for (const category of ['single', 'split', 'combine'] as const) {
      assert.deepStrictEqual(properties[`graphics-workbench.conversion.${category}.enabled`], {
        type: 'boolean',
        default: true,
        description: `%config.conversion.${category}.enabled%`,
      });
    }
  });

  test('入力形式ごとのcontextMenu.convertXxx.enabled設定を公開せず、変換表示制御はsingle/split/combineへ一本化する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const { properties } = packageJson.contributes.configuration;
    const removedProperties = Object.keys(properties).filter((key) =>
      key.startsWith('graphics-workbench.contextMenu.convert'),
    );

    assert.deepStrictEqual(
      removedProperties,
      [],
      `format-specific conversion toggles must be removed: ${removedProperties.join(', ')}`,
    );
  });

  test('変換サブメニューと各変換commandのwhen句にグローバル有効化設定・single/split/combine設定・gif/tiff拡張子を含め、カテゴリ単位で表示を制御する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const explorerContext = packageJson.contributes.menus['explorer/context'] ?? [];
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const convertSubmenu = explorerContext.find((entry) => entry.submenu === CONVERT_SUBMENU);
    const commandEntries = new Map(
      [...explorerContext, ...convertMenu]
        .filter((entry): entry is typeof entry & { command: string } => entry.command !== undefined)
        .map((entry) => [entry.command, entry]),
    );

    assert.ok(convertSubmenu?.when?.includes(CONTEXT_MENU_ENABLED));
    for (const category of ['single', 'split', 'combine'] as const) {
      assert.ok(
        convertSubmenu?.when?.includes(CATEGORY_PROPERTY[category]),
        `${CATEGORY_PROPERTY[category]} is not on the convert submenu`,
      );
    }
    assert.ok(convertSubmenu?.when?.includes('gif'), 'convert submenu must gate on animated GIF inputs');
    assert.ok(convertSubmenu?.when?.includes('tiff?'), 'convert submenu must gate on TIFF inputs');

    for (const [command, categories] of Object.entries(EXPECTED_CATEGORIES_BY_COMMAND)) {
      const entry = commandEntries.get(command);
      assert.ok(entry?.when?.includes(CONTEXT_MENU_ENABLED), `${command} does not preserve the global setting`);
      for (const category of categories) {
        assert.ok(
          entry?.when?.includes(CATEGORY_PROPERTY[category]),
          `${CATEGORY_PROPERTY[category]} is not used by ${command}`,
        );
      }
    }
  });

  test('PDF入力の画像変換when句にはsplit.enabled、PDF以外の入力にはsingle.enabledを対応させる', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const convertToPng = convertMenu.find((entry) => entry.command === 'graphics-workbench.convertToPng');

    assert.ok(convertToPng?.when?.includes('config.graphics-workbench.conversion.split.enabled'));
    assert.ok(convertToPng?.when?.includes('config.graphics-workbench.conversion.single.enabled'));
    assert.ok(convertToPng?.when?.includes('resourceExtname =~ /^\\.pdf$/i'));
  });

  test('Save As版とQuick版の両方の画像PDF結合コマンドのwhen句にgif/tiff拡張子を含め、複合Draw.io画像のときは非表示にしてcombine設定で制御する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const combineEntries = convertMenu.filter((entry) =>
      [COMBINE_IMAGES_TO_PDF_COMMAND, QUICK_COMBINE_IMAGES_TO_PDF_COMMAND].includes(entry.command ?? ''),
    );

    assert.strictEqual(combineEntries.length, 2);
    for (const entry of combineEntries) {
      assert.ok(entry.when?.includes(CONTEXT_MENU_ENABLED));
      assert.ok(entry.when?.includes(CATEGORY_PROPERTY.combine));
      assert.ok(entry.when?.includes(COMPOUND_DRAWIO_NOT_MATCH));
      assert.ok(entry.when?.includes('resourceExtname =~ /^\\.gif$/i'));
      assert.ok(entry.when?.includes('resourceExtname =~ /^\\.tiff?$/i'));
      assert.ok(!entry.when?.includes('config.graphics-workbench.conversion.single.enabled'));
      assert.ok(!entry.when?.includes('config.graphics-workbench.conversion.split.enabled'));
    }
  });

  test('アニメーションを保持する通常コマンドはsingle.enabled、フレーム分割コマンドはsplit.enabledで制御する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const findEntry = (command: string) => convertMenu.find((entry) => entry.command === command);

    const preserveCommands = ['graphics-workbench.convertToWebp', 'graphics-workbench.convertToGif'];
    const separatelyCommands = [
      'graphics-workbench.convertToWebpSeparately',
      'graphics-workbench.convertToGifSeparately',
    ];

    for (const command of preserveCommands) {
      const entry = findEntry(command);
      assert.ok(entry?.when?.includes(CATEGORY_PROPERTY.single), `${command} must depend on single.enabled`);
    }
    for (const command of separatelyCommands) {
      const entry = findEntry(command);
      assert.ok(entry?.when?.includes(CATEGORY_PROPERTY.split), `${command} must depend on split.enabled`);
    }
  });

  test('変換サブメニューをExplorerに表示し、convertToPdfをmmd/mermaid/drawio/dio入力で表示し、複合Draw.io画像のエントリも追加する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const explorerContext = packageJson.contributes.menus['explorer/context'] ?? [];
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const submenu = packageJson.contributes.submenus.find((entry) => entry.id === CONVERT_SUBMENU);
    const convertToPdf = convertMenu.find((entry) => entry.command === 'graphics-workbench.convertToPdf');

    assert.strictEqual(submenu?.label, '%submenu.convert%');
    assert.ok(explorerContext.some((entry) => entry.submenu === CONVERT_SUBMENU));
    assert.ok(convertToPdf);
    assert.ok(convertToPdf.when?.includes('mmd'));
    assert.ok(convertToPdf.when?.includes('mermaid'));
    assert.ok(convertToPdf.when?.includes('drawio'));
    assert.ok(convertToPdf.when?.includes('dio'));

    assert.ok(
      explorerContext.some(
        (entry) =>
          entry.submenu === CONVERT_SUBMENU &&
          entry.when?.includes('resourceFilename') &&
          entry.when.includes('drawio') &&
          entry.when.includes('dio') &&
          entry.when.includes('png') &&
          entry.when.includes('svg'),
      ),
    );
  });

  test('変換サブメニューとconvertToPdfのwhen句にresourceExtnameとresourceFilenameの大文字小文字非依存(/i)正規表現が含まれることを検証する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const explorerContext = packageJson.contributes.menus['explorer/context'] ?? [];
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const convertSubmenu = explorerContext.find((entry) => entry.submenu === CONVERT_SUBMENU);
    const convertToPdf = convertMenu.find((entry) => entry.command === 'graphics-workbench.convertToPdf');

    assert.ok(convertSubmenu?.when);
    assert.ok(convertToPdf?.when);

    for (const whenClause of [convertSubmenu.when, convertToPdf.when]) {
      assert.match(whenClause, /resourceExtname =~ \/.+\/i/);
      assert.match(whenClause, /resourceFilename =~ \/.+\/i/);
    }
  });

  test('変換サブメニューにconvertToSvgを載せ、pdf/mmd/mermaid/drawio/dio入力のときだけ表示するwhen句にする', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const explorerContext = packageJson.contributes.menus['explorer/context'] ?? [];
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const convertToSvg = convertMenu.find((entry) => entry.command === 'graphics-workbench.convertToSvg');

    assert.ok(
      explorerContext.some(
        (entry) => entry.submenu === CONVERT_SUBMENU && entry.when?.includes('mmd') && entry.when.includes('mermaid'),
      ),
    );
    assert.ok(convertToSvg);
    assert.ok(convertToSvg.when?.includes('pdf'));
    assert.ok(convertToSvg.when?.includes('mmd'));
    assert.ok(convertToSvg.when?.includes('mermaid'));
    assert.ok(convertToSvg.when?.includes('drawio'));
    assert.ok(convertToSvg.when?.includes('dio'));
  });

  test('変換サブメニューにconvertToPngを載せ、pdf/svg/mmd/mermaid/jpg/jpeg/webp/avif/drawio/dio入力のときだけ表示するwhen句にする', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const explorerContext = packageJson.contributes.menus['explorer/context'] ?? [];
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const convertToPng = convertMenu.find((entry) => entry.command === 'graphics-workbench.convertToPng');

    assert.ok(
      explorerContext.some(
        (entry) =>
          entry.submenu === CONVERT_SUBMENU &&
          entry.when?.includes('mmd') &&
          entry.when.includes('mermaid') &&
          entry.when.includes('drawio') &&
          entry.when.includes('dio'),
      ),
    );
    assert.ok(convertToPng);
    assert.ok(convertToPng.when?.includes('pdf'));
    assert.ok(convertToPng.when?.includes('svg'));
    assert.ok(convertToPng.when?.includes('mmd'));
    assert.ok(convertToPng.when?.includes('mermaid'));
    assert.ok(convertToPng.when?.includes('jpg'));
    assert.ok(convertToPng.when?.includes('jpeg'));
    assert.ok(convertToPng.when?.includes('webp'));
    assert.ok(convertToPng.when?.includes('avif'));
    assert.ok(convertToPng.when?.includes('drawio'));
    assert.ok(convertToPng.when?.includes('dio'));
  });

  test('変換サブメニューにconvertToJpegを載せ、pdf/png/svg/mmd/mermaid/webp/avif/drawio/dio入力のときだけ表示するwhen句にする', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const explorerContext = packageJson.contributes.menus['explorer/context'] ?? [];
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const convertToJpeg = convertMenu.find((entry) => entry.command === 'graphics-workbench.convertToJpeg');

    assert.ok(
      explorerContext.some(
        (entry) =>
          entry.submenu === CONVERT_SUBMENU &&
          entry.when?.includes('mmd') &&
          entry.when.includes('mermaid') &&
          entry.when.includes('drawio') &&
          entry.when.includes('dio'),
      ),
    );
    assert.ok(convertToJpeg);
    assert.ok(convertToJpeg.when?.includes('pdf'));
    assert.ok(convertToJpeg.when?.includes('png'));
    assert.ok(convertToJpeg.when?.includes('svg'));
    assert.ok(convertToJpeg.when?.includes('mmd'));
    assert.ok(convertToJpeg.when?.includes('mermaid'));
    assert.ok(convertToJpeg.when?.includes('webp'));
    assert.ok(convertToJpeg.when?.includes('avif'));
    assert.ok(convertToJpeg.when?.includes('drawio'));
    assert.ok(convertToJpeg.when?.includes('dio'));
  });

  test('変換サブメニューにconvertToWebpを載せ、pdf/png/jpg/jpeg/svg/mmd/mermaid/avif/drawio/dio入力のときだけ表示するwhen句にする', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const explorerContext = packageJson.contributes.menus['explorer/context'] ?? [];
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const convertToWebp = convertMenu.find((entry) => entry.command === 'graphics-workbench.convertToWebp');

    assert.ok(
      explorerContext.some(
        (entry) =>
          entry.submenu === CONVERT_SUBMENU &&
          entry.when?.includes('mmd') &&
          entry.when.includes('mermaid') &&
          entry.when.includes('drawio') &&
          entry.when.includes('dio'),
      ),
    );
    assert.ok(convertToWebp);
    assert.ok(convertToWebp.when?.includes('pdf'));
    assert.ok(convertToWebp.when?.includes('png'));
    assert.ok(convertToWebp.when?.includes('jpg'));
    assert.ok(convertToWebp.when?.includes('jpeg'));
    assert.ok(convertToWebp.when?.includes('svg'));
    assert.ok(convertToWebp.when?.includes('mmd'));
    assert.ok(convertToWebp.when?.includes('mermaid'));
    assert.ok(convertToWebp.when?.includes('avif'));
    assert.ok(convertToWebp.when?.includes('drawio'));
    assert.ok(convertToWebp.when?.includes('dio'));
  });

  test('変換サブメニューにconvertToAvifを載せ、pdf/png/jpg/jpeg/webp/svg/mmd/mermaid/drawio/dio入力のときだけ表示するwhen句にする', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const explorerContext = packageJson.contributes.menus['explorer/context'] ?? [];
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const convertToAvif = convertMenu.find((entry) => entry.command === 'graphics-workbench.convertToAvif');

    assert.ok(
      explorerContext.some(
        (entry) =>
          entry.submenu === CONVERT_SUBMENU &&
          entry.when?.includes('mmd') &&
          entry.when.includes('mermaid') &&
          entry.when.includes('drawio') &&
          entry.when.includes('dio'),
      ),
    );
    assert.ok(convertToAvif);
    assert.ok(convertToAvif.when?.includes('pdf'));
    assert.ok(convertToAvif.when?.includes('png'));
    assert.ok(convertToAvif.when?.includes('jpg'));
    assert.ok(convertToAvif.when?.includes('jpeg'));
    assert.ok(convertToAvif.when?.includes('webp'));
    assert.ok(convertToAvif.when?.includes('svg'));
    assert.ok(convertToAvif.when?.includes('mmd'));
    assert.ok(convertToAvif.when?.includes('mermaid'));
    assert.ok(convertToAvif.when?.includes('drawio'));
    assert.ok(convertToAvif.when?.includes('dio'));
  });

  test('convertToGif・convertToGifSeparatelyの2コマンドを公開する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const commandIds = new Set(packageJson.contributes.commands.map((command) => command.command));

    assert.ok(commandIds.has('graphics-workbench.convertToGif'));
    assert.ok(commandIds.has('graphics-workbench.convertToGifSeparately'));
  });

  test('convertToWebp・convertToWebpSeparatelyの2コマンドを公開する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const commandIds = new Set(packageJson.contributes.commands.map((command) => command.command));

    assert.ok(commandIds.has('graphics-workbench.convertToWebp'));
    assert.ok(commandIds.has('graphics-workbench.convertToWebpSeparately'));
  });

  test('GIF/WebPのアニメーション保持とフレーム分割を通常・Separatelyコマンドで変換サブメニューに載せる', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const commands = new Set(convertMenu.map((entry) => entry.command));

    assert.ok(commands.has('graphics-workbench.convertToWebp'));
    assert.ok(commands.has('graphics-workbench.convertToWebpSeparately'));
    assert.ok(commands.has('graphics-workbench.convertToGif'));
    assert.ok(commands.has('graphics-workbench.convertToGifSeparately'));
  });

  test('GIF/WebPのアニメーション保持とフレーム分割コマンドをcommandPaletteでwhen=falseにして非表示にする', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const paletteEntries = packageJson.contributes.menus.commandPalette ?? [];
    const paletteHidden = new Set(paletteEntries.filter((e) => e.when === 'false').map((e) => e.command));

    assert.ok(paletteHidden.has('graphics-workbench.convertToWebpSeparately'));
    assert.ok(paletteHidden.has('graphics-workbench.convertToGifSeparately'));
  });

  test('Save As / Quickの両方の画像PDF結合コマンドを公開し、両方ともcommandPaletteで非表示にしてExplorerの変換サブメニューだけに載せる', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const commandIds = new Set(packageJson.contributes.commands.map((command) => command.command));
    const paletteEntries = packageJson.contributes.menus.commandPalette ?? [];
    const paletteHidden = new Set(paletteEntries.filter((e) => e.when === 'false').map((e) => e.command));
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];

    assert.ok(commandIds.has(COMBINE_IMAGES_TO_PDF_COMMAND));
    assert.ok(commandIds.has(QUICK_COMBINE_IMAGES_TO_PDF_COMMAND));
    assert.ok(paletteHidden.has(COMBINE_IMAGES_TO_PDF_COMMAND));
    assert.ok(paletteHidden.has(QUICK_COMBINE_IMAGES_TO_PDF_COMMAND));
    assert.ok(convertMenu.some((entry) => entry.command === COMBINE_IMAGES_TO_PDF_COMMAND));
    assert.ok(convertMenu.some((entry) => entry.command === QUICK_COMBINE_IMAGES_TO_PDF_COMMAND));
  });

  test('通常のWebP/GIFは相互のanimated入力を含み、Separatelyは対応するanimated入力だけに表示する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const findEntry = (command: string) => convertMenu.find((e) => e.command === command);

    const webp = findEntry('graphics-workbench.convertToWebp');
    const webpSeparately = findEntry('graphics-workbench.convertToWebpSeparately');
    const gif = findEntry('graphics-workbench.convertToGif');
    const gifSeparately = findEntry('graphics-workbench.convertToGifSeparately');

    assert.ok(webp?.when?.includes('resourceExtname =~ /^\\.gif$/i'));
    assert.ok(webpSeparately?.when?.includes('resourceExtname =~ /^\\.gif$/i'));
    assert.ok(!webpSeparately?.when?.includes('.webp'), 'WebP separately should not match .webp');

    assert.ok(gif?.when?.includes('resourceExtname =~ /^\\.webp$/i'));
    assert.ok(gifSeparately?.when?.includes('resourceExtname =~ /^\\.webp$/i'));
    assert.ok(!gifSeparately?.when?.includes('.gif'), 'GIF separately should not match .gif');
  });

  test('通常のconvertToWebpのwhen句に.gifを含めず、通常のconvertToGifのwhen句に.webpを含めない', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const findEntry = (command: string) => convertMenu.find((e) => e.command === command);

    const webp = findEntry('graphics-workbench.convertToWebp');
    const gif = findEntry('graphics-workbench.convertToGif');

    assert.ok(webp?.when?.includes('gif'), 'Standard WebP should match .gif');
    assert.ok(gif?.when?.includes('.webp'), 'Standard GIF should match .webp');
  });

  test('package.jsonのcommand titleを%キー%参照にし、日本語ラベルが選択したファイルを各形式に変換する行動ベースの文言とGIF/WebPのアニメーション保持・フレーム分割文言であることを検証する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const jaMessages = await readJson<Record<string, string>>('package.nls.ja.json');
    const convertToPdf = packageJson.contributes.commands.find(
      (command) => command.command === 'graphics-workbench.convertToPdf',
    );

    assert.strictEqual(convertToPdf?.title, '%command.convertToPdf%');
    assert.strictEqual(jaMessages['submenu.convert'], '変換');
    assert.strictEqual(jaMessages['command.convertToPdf'], '選択したファイルをPDFに変換');
    assert.strictEqual(jaMessages['command.convertToPng'], '選択したファイルをPNGに変換');
    assert.strictEqual(jaMessages['command.convertToJpeg'], '選択したファイルをJPEGに変換');
    assert.strictEqual(jaMessages['command.convertToWebp'], '選択したファイルをWebPに変換');
    assert.strictEqual(jaMessages['command.convertToAvif'], '選択したファイルをAVIFに変換');
    assert.strictEqual(jaMessages['command.convertToSvg'], '選択したファイルをSVGに変換');
    assert.strictEqual(jaMessages['command.convertToGif'], '選択したファイルをGIFに変換');
    assert.strictEqual(jaMessages['command.convertToGifSeparately'], 'GIF: フレーム分割');
    assert.strictEqual(jaMessages['command.convertToWebpSeparately'], 'WebP: フレーム分割');
    assert.strictEqual(jaMessages['command.combineImagesToPdf'], '画像をPDFに結合（保存先を指定）');
    assert.strictEqual(jaMessages['command.quickCombineImagesToPdf'], '画像をPDFにクイック結合');
  });

  test('package.nls.jsonとpackage.nls.ja.jsonのキー一覧をソートして比較し、欠落や余分なキーが無いことを検証する', async () => {
    const enMessages = await readJson<Record<string, string>>('package.nls.json');
    const jaMessages = await readJson<Record<string, string>>('package.nls.ja.json');

    assert.deepStrictEqual(sortedKeys(jaMessages), sortedKeys(enMessages));
  });

  test('convertToWebp.effortをdefault:4・範囲0-6で、convertToAvif.effortをdefault:4・範囲0-9で公開する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const { properties } = packageJson.contributes.configuration;

    assert.deepStrictEqual(properties['graphics-workbench.convertToWebp.effort'], {
      type: 'integer',
      default: 4,
      minimum: 0,
      maximum: 6,
      description: '%config.convertToWebp.effort%',
    });
    assert.deepStrictEqual(properties['graphics-workbench.convertToAvif.effort'], {
      type: 'integer',
      default: 4,
      minimum: 0,
      maximum: 9,
      description: '%config.convertToAvif.effort%',
    });
  });

  test('outputPathをsingle/split/combine×形式で定義し、source×target形式の設定を持たない', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const { properties } = packageJson.contributes.configuration;
    const outputPathKeys = Object.keys(properties).filter((key) => key.startsWith('graphics-workbench.outputPath.'));

    assert.strictEqual(
      properties['graphics-workbench.outputPath.split.png']?.default,
      '${fileDirname}/${fileBasenameNoExtension}/${page}.png',
    );
    assert.strictEqual(
      properties['graphics-workbench.outputPath.split.pdf']?.default,
      '${fileDirname}/${fileBasenameNoExtension}/${page}.pdf',
    );
    assert.strictEqual(
      properties['graphics-workbench.outputPath.single.webp']?.default,
      '${fileDirname}/${fileBasenameNoExtension}.webp',
    );
    assert.strictEqual(
      properties['graphics-workbench.outputPath.single.drawio']?.default,
      '${fileDirname}/${fileBasenameNoExtension}.dio',
    );
    assert.strictEqual(
      properties['graphics-workbench.outputPath.combine.pdf']?.default,
      '${workspaceFolder}/combined-${random}.pdf',
    );
    assert.ok(
      outputPathKeys.every((key) => !key.includes('To') && key !== 'graphics-workbench.outputPath.combineImagesToPdf'),
      `unexpected source-to-target output path settings: ${outputPathKeys
        .filter((key) => key.includes('To') || key === 'graphics-workbench.outputPath.combineImagesToPdf')
        .join(', ')}`,
    );
  });

  test('すべてのoutputPath文字列設定に空でないschema制約minLength:1を付ける', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const outputPathEntries = Object.entries(packageJson.contributes.configuration.properties).filter(
      ([key, schema]) => key.startsWith('graphics-workbench.outputPath.') && schema.type === 'string',
    );

    assert.ok(outputPathEntries.length > 0);
    for (const [key, schema] of outputPathEntries) {
      assert.strictEqual(schema.minLength, 1, `${key} must reject empty strings in its schema`);
    }
  });

  test('PDFとTIFFのCustom Editorをpriority:optionで登録し、displayNameを%キー%参照・selectorを拡張子パターンにする', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const customEditors = packageJson.contributes.customEditors ?? [];
    const pdfEditor = customEditors.find((editor) => editor.viewType === 'graphics-workbench.pdf.preview');
    const tiffEditor = customEditors.find((editor) => editor.viewType === 'graphics-workbench.tiff.preview');

    assert.ok(pdfEditor, 'PDF preview custom editor is missing');
    assert.strictEqual(pdfEditor.priority, 'option');
    assert.strictEqual(pdfEditor.displayName, '%customEditor.pdf.preview.displayName%');
    assert.deepStrictEqual(pdfEditor.selector, [{ filenamePattern: '*.pdf' }]);

    assert.ok(tiffEditor, 'TIFF preview custom editor is missing');
    assert.strictEqual(tiffEditor.priority, 'option');
    assert.strictEqual(tiffEditor.displayName, '%customEditor.tiff.preview.displayName%');
    assert.deepStrictEqual(tiffEditor.selector, [{ filenamePattern: '*.tif' }, { filenamePattern: '*.tiff' }]);

    for (const editor of customEditors) {
      assert.match(editor.viewType, /^graphics-workbench\./u);
    }
  });

  test('onLanguage:latexをactivationEventsに含め、LaTeX文書を開いたときdrag and drop / clipboard paste用に拡張機能を起動する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');

    assert.ok(packageJson.activationEvents?.includes('onLanguage:latex'));
  });

  test('LaTeX挿入用のclipboard画像出力先設定outputPath.clipboardImageをtype:string・default:${fileDirname}/${dateNow}で公開する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const { properties } = packageJson.contributes.configuration;

    assert.deepStrictEqual(properties['graphics-workbench.outputPath.clipboardImage'], {
      type: 'string',
      default: '${fileDirname}/${dateNow}',
      description: '%config.outputPath.clipboardImage%',
      minLength: 1,
    });
  });
});

async function readJson<T extends PackageJson | Record<string, string>>(
  relativePath: 'package.json' | 'package.nls.json' | 'package.nls.ja.json',
): Promise<T>;
async function readJson(relativePath: string): Promise<PackageJson | Record<string, string>> {
  const content = await readFile(path.join(projectRootDirectory, 'vscode', relativePath), 'utf8');
  const value: unknown = JSON.parse(content);
  if (relativePath === 'package.json') {
    if (!isPackageJson(value)) {
      throw new Error('package.json has an unexpected structure.');
    }
    return value;
  }
  if (!isStringRecord(value)) {
    throw new Error(`${relativePath} has an unexpected structure.`);
  }
  return value;
}

function isPackageJson(value: unknown): value is PackageJson {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.homepage !== 'string' ||
    !isRecord(value.repository) ||
    typeof value.repository.type !== 'string' ||
    typeof value.repository.url !== 'string' ||
    !isRecord(value.devEngines) ||
    !isRecord(value.engines) ||
    !isRecord(value.contributes)
  ) {
    return false;
  }

  const { devEngines } = value;
  const { engines } = value;
  const { contributes } = value;
  const { configuration } = contributes;

  return (
    isRecord(devEngines.packageManager) &&
    isRecord(devEngines.runtime) &&
    typeof devEngines.packageManager.name === 'string' &&
    typeof devEngines.packageManager.version === 'string' &&
    typeof devEngines.packageManager.onFail === 'string' &&
    typeof devEngines.runtime.name === 'string' &&
    typeof devEngines.runtime.version === 'string' &&
    typeof devEngines.runtime.onFail === 'string' &&
    typeof engines.vscode === 'string' &&
    (engines.node === undefined || typeof engines.node === 'string') &&
    (value.activationEvents === undefined || isStringArray(value.activationEvents)) &&
    isCommandArray(contributes.commands) &&
    isRecord(configuration) &&
    isConfigurationProperties(configuration.properties) &&
    isMenuRecord(contributes.menus) &&
    isSubmenuArray(contributes.submenus) &&
    isCustomEditorArray(contributes.customEditors)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isCommandArray(value: unknown): value is PackageJson['contributes']['commands'] {
  return (
    Array.isArray(value) &&
    value.every((entry) => isRecord(entry) && typeof entry.command === 'string' && typeof entry.title === 'string')
  );
}

function isConfigurationProperties(value: unknown): value is PackageJson['contributes']['configuration']['properties'] {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) =>
        isRecord(entry) &&
        (typeof entry.type === 'string' ||
          (Array.isArray(entry.type) && entry.type.every((type) => typeof type === 'string'))) &&
        typeof entry.description === 'string' &&
        'default' in entry,
    )
  );
}

function isMenuRecord(value: unknown): value is PackageJson['contributes']['menus'] {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entries) =>
        Array.isArray(entries) &&
        entries.every(
          (entry) =>
            isRecord(entry) &&
            (entry.command === undefined || typeof entry.command === 'string') &&
            (entry.submenu === undefined || typeof entry.submenu === 'string') &&
            (entry.when === undefined || typeof entry.when === 'string'),
        ),
    )
  );
}

function isSubmenuArray(value: unknown): value is PackageJson['contributes']['submenus'] {
  return (
    Array.isArray(value) &&
    value.every((entry) => isRecord(entry) && typeof entry.id === 'string' && typeof entry.label === 'string')
  );
}

function isCustomEditorArray(value: unknown): value is PackageJson['contributes']['customEditors'] {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (entry) =>
          isRecord(entry) &&
          typeof entry.viewType === 'string' &&
          typeof entry.displayName === 'string' &&
          typeof entry.priority === 'string' &&
          Array.isArray(entry.selector) &&
          entry.selector.every((selector) => isRecord(selector) && typeof selector.filenamePattern === 'string'),
      ))
  );
}

function sortedKeys(record: Record<string, string>): string[] {
  const keys = Object.keys(record);
  // 比較用の一時配列だけを並び替えるため、呼び出し元の値は変更しない。
  return keys.toSorted();
}

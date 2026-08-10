import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  commandContributions,
  publicCommandIds,
  submenuContributions,
  type SubmenuId,
} from '../src/generated/extension_manifest.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const COMBINE_IMAGES_TO_PDF_COMMAND = 'graphics-workbench.combineImagesToPdf';
const CONVERT_SUBMENU = 'graphics-workbench.convert';
const CONTEXT_MENU_ENABLED = 'config.graphics-workbench.contextMenu.enabled';
const COMPOUND_DRAWIO_MATCH = 'resourceFilename =~ /\\.(drawio|dio)\\.(png|svg)$/i';
const COMPOUND_DRAWIO_NOT_MATCH = `!(${COMPOUND_DRAWIO_MATCH})`;
const CONVERSION_CONTEXT_MENU_SETTINGS = {
  drawio: {
    property: 'graphics-workbench.contextMenu.convertDrawio.enabled',
    description: 'config.contextMenu.convertDrawio.enabled',
  },
  pdf: {
    property: 'graphics-workbench.contextMenu.convertPdf.enabled',
    description: 'config.contextMenu.convertPdf.enabled',
  },
  png: {
    property: 'graphics-workbench.contextMenu.convertPng.enabled',
    description: 'config.contextMenu.convertPng.enabled',
  },
  jpeg: {
    property: 'graphics-workbench.contextMenu.convertJpeg.enabled',
    description: 'config.contextMenu.convertJpeg.enabled',
  },
  webp: {
    property: 'graphics-workbench.contextMenu.convertWebp.enabled',
    description: 'config.contextMenu.convertWebp.enabled',
  },
  avif: {
    property: 'graphics-workbench.contextMenu.convertAvif.enabled',
    description: 'config.contextMenu.convertAvif.enabled',
  },
  svg: {
    property: 'graphics-workbench.contextMenu.convertSvg.enabled',
    description: 'config.contextMenu.convertSvg.enabled',
  },
  mermaid: {
    property: 'graphics-workbench.contextMenu.convertMermaid.enabled',
    description: 'config.contextMenu.convertMermaid.enabled',
  },
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

  test('入力形式ごとの変換コンテキストメニュー有効化設定をtype:boolean・default:true・description:%キー%で公開する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const { properties } = packageJson.contributes.configuration;

    for (const setting of Object.values(CONVERSION_CONTEXT_MENU_SETTINGS)) {
      assert.deepStrictEqual(properties[setting.property], {
        type: 'boolean',
        default: true,
        description: `%${setting.description}%`,
      });
    }
  });

  test('変換サブメニューと各変換commandのwhen句にグローバル有効化設定・対応する入力形式の設定・gif/tiff拡張子を含め、commandごとの指定設定で表示を制御する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const explorerContext = packageJson.contributes.menus['explorer/context'] ?? [];
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const convertSubmenu = explorerContext.find((entry) => entry.submenu === CONVERT_SUBMENU);
    const commandEntries = new Map(
      [...explorerContext, ...convertMenu]
        .filter((entry): entry is typeof entry & { command: string } => entry.command !== undefined)
        .map((entry) => [entry.command, entry]),
    );
    const expectedSettingsByCommand: Record<string, string[]> = {
      'graphics-workbench.convertToPdf': [
        CONVERSION_CONTEXT_MENU_SETTINGS.png.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.jpeg.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.webp.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.avif.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.mermaid.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.drawio.property,
      ],
      'graphics-workbench.convertToPng': [
        CONVERSION_CONTEXT_MENU_SETTINGS.pdf.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.jpeg.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.webp.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.avif.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.svg.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.mermaid.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.drawio.property,
      ],
      'graphics-workbench.convertToJpeg': [
        CONVERSION_CONTEXT_MENU_SETTINGS.pdf.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.png.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.webp.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.avif.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.svg.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.mermaid.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.drawio.property,
      ],
      'graphics-workbench.convertToWebp': [
        CONVERSION_CONTEXT_MENU_SETTINGS.pdf.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.png.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.jpeg.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.avif.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.svg.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.mermaid.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.drawio.property,
      ],
      'graphics-workbench.convertToAvif': [
        CONVERSION_CONTEXT_MENU_SETTINGS.pdf.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.png.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.jpeg.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.webp.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.svg.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.mermaid.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.drawio.property,
      ],
      'graphics-workbench.convertToSvg': [
        CONVERSION_CONTEXT_MENU_SETTINGS.pdf.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.mermaid.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.drawio.property,
      ],
      'graphics-workbench.convertDrawioToPagePdfs': [CONVERSION_CONTEXT_MENU_SETTINGS.drawio.property],
      'graphics-workbench.convertDrawioToSinglePdf': [CONVERSION_CONTEXT_MENU_SETTINGS.drawio.property],
      [COMBINE_IMAGES_TO_PDF_COMMAND]: [
        CONVERSION_CONTEXT_MENU_SETTINGS.png.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.jpeg.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.webp.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.avif.property,
        CONVERSION_CONTEXT_MENU_SETTINGS.svg.property,
      ],
    };

    assert.ok(convertSubmenu?.when?.includes(CONTEXT_MENU_ENABLED));
    for (const setting of Object.values(CONVERSION_CONTEXT_MENU_SETTINGS)) {
      assert.ok(convertSubmenu?.when?.includes(setting.property), `${setting.property} is not on the convert submenu`);
    }
    assert.ok(convertSubmenu?.when?.includes('resourceExtname =~ /^\\.gif$/i'));
    assert.ok(convertSubmenu?.when?.includes('resourceExtname =~ /^\\.tiff?$/i'));

    for (const [command, settings] of Object.entries(expectedSettingsByCommand)) {
      const entry = commandEntries.get(command);
      assert.ok(entry?.when?.includes(CONTEXT_MENU_ENABLED), `${command} does not preserve the global setting`);
      for (const setting of settings) {
        assert.ok(entry?.when?.includes(setting), `${setting} is not used by ${command}`);
      }
    }
  });

  test('画像PDF結合コマンドのwhen句にgif/tiff拡張子を含め、複合Draw.io画像（.drawio/.dioの.png/.svg）のときは非表示にしてDraw.io設定では制御しない', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const combineImagesToSinglePdf = convertMenu.find((entry) => entry.command === COMBINE_IMAGES_TO_PDF_COMMAND);

    assert.ok(combineImagesToSinglePdf?.when?.includes(CONTEXT_MENU_ENABLED));
    assert.ok(combineImagesToSinglePdf?.when?.includes(COMPOUND_DRAWIO_NOT_MATCH));
    assert.ok(combineImagesToSinglePdf?.when?.includes('resourceExtname =~ /^\\.gif$/i'));
    assert.ok(combineImagesToSinglePdf?.when?.includes('resourceExtname =~ /^\\.tiff?$/i'));
    assert.ok(!combineImagesToSinglePdf?.when?.includes(CONVERSION_CONTEXT_MENU_SETTINGS.drawio.property));
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

  test('convertToGif・convertToGifPreserveAnimation・convertToGifSeparatelyの3コマンドを公開する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const commandIds = new Set(packageJson.contributes.commands.map((command) => command.command));

    assert.ok(commandIds.has('graphics-workbench.convertToGif'));
    assert.ok(commandIds.has('graphics-workbench.convertToGifPreserveAnimation'));
    assert.ok(commandIds.has('graphics-workbench.convertToGifSeparately'));
  });

  test('convertToWebp・convertToWebpPreserveAnimation・convertToWebpSeparatelyの3コマンドを公開する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const commandIds = new Set(packageJson.contributes.commands.map((command) => command.command));

    assert.ok(commandIds.has('graphics-workbench.convertToWebp'));
    assert.ok(commandIds.has('graphics-workbench.convertToWebpPreserveAnimation'));
    assert.ok(commandIds.has('graphics-workbench.convertToWebpSeparately'));
  });

  test('GIF/WebPのアニメーション保持とフレーム分割の4コマンドを変換サブメニューに載せる', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const commands = new Set(convertMenu.map((entry) => entry.command));

    assert.ok(commands.has('graphics-workbench.convertToWebpPreserveAnimation'));
    assert.ok(commands.has('graphics-workbench.convertToWebpSeparately'));
    assert.ok(commands.has('graphics-workbench.convertToGifPreserveAnimation'));
    assert.ok(commands.has('graphics-workbench.convertToGifSeparately'));
  });

  test('GIF/WebPのアニメーション保持とフレーム分割コマンドをcommandPaletteでwhen=falseにして非表示にする', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const paletteEntries = packageJson.contributes.menus.commandPalette ?? [];
    const paletteHidden = new Set(paletteEntries.filter((e) => e.when === 'false').map((e) => e.command));

    assert.ok(paletteHidden.has('graphics-workbench.convertToWebpPreserveAnimation'));
    assert.ok(paletteHidden.has('graphics-workbench.convertToWebpSeparately'));
    assert.ok(paletteHidden.has('graphics-workbench.convertToGifPreserveAnimation'));
    assert.ok(paletteHidden.has('graphics-workbench.convertToGifSeparately'));
  });

  test('WebPのアニメーション保持・フレーム分割は.gif入力のときだけ表示し、GIFのアニメーション保持・フレーム分割は.webp入力のときだけ表示する', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const findEntry = (command: string) => convertMenu.find((e) => e.command === command);

    const webpPreserve = findEntry('graphics-workbench.convertToWebpPreserveAnimation');
    const webpSeparately = findEntry('graphics-workbench.convertToWebpSeparately');
    const gifPreserve = findEntry('graphics-workbench.convertToGifPreserveAnimation');
    const gifSeparately = findEntry('graphics-workbench.convertToGifSeparately');

    assert.ok(webpPreserve?.when?.includes('resourceExtname =~ /^\\.gif$/i'));
    assert.ok(!webpPreserve?.when?.includes('.webp'), 'WebP preserve should not match .webp');
    assert.ok(webpSeparately?.when?.includes('resourceExtname =~ /^\\.gif$/i'));
    assert.ok(!webpSeparately?.when?.includes('.webp'), 'WebP separately should not match .webp');

    assert.ok(gifPreserve?.when?.includes('resourceExtname =~ /^\\.webp$/i'));
    assert.ok(!gifPreserve?.when?.includes('.gif'), 'GIF preserve should not match .gif');
    assert.ok(gifSeparately?.when?.includes('resourceExtname =~ /^\\.webp$/i'));
    assert.ok(!gifSeparately?.when?.includes('.gif'), 'GIF separately should not match .gif');
  });

  test('通常のconvertToWebpのwhen句に.gifを含めず、通常のconvertToGifのwhen句に.webpを含めない', async () => {
    const packageJson = await readJson<PackageJson>('package.json');
    const convertMenu = packageJson.contributes.menus[CONVERT_SUBMENU] ?? [];
    const findEntry = (command: string) => convertMenu.find((e) => e.command === command);

    const webp = findEntry('graphics-workbench.convertToWebp');
    const gif = findEntry('graphics-workbench.convertToGif');

    assert.ok(!webp?.when?.includes('gif'), 'Standard WebP should not match .gif');
    assert.ok(!gif?.when?.includes('.webp'), 'Standard GIF should not match .webp');
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
    assert.strictEqual(jaMessages['command.convertToGifPreserveAnimation'], 'GIF: アニメーションを保持');
    assert.strictEqual(jaMessages['command.convertToGifSeparately'], 'GIF: フレーム分割');
    assert.strictEqual(jaMessages['command.convertToWebpPreserveAnimation'], 'WebP: アニメーションを保持');
    assert.strictEqual(jaMessages['command.convertToWebpSeparately'], 'WebP: フレーム分割');
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

  test('outputPathをsingle/split×形式で定義し、source×target形式の設定を持たない', async () => {
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
    assert.ok(
      outputPathKeys.every((key) => !key.includes('To') && key !== 'graphics-workbench.outputPath.combineImagesToPdf'),
      `unexpected source-to-target output path settings: ${outputPathKeys
        .filter((key) => key.includes('To') || key === 'graphics-workbench.outputPath.combineImagesToPdf')
        .join(', ')}`,
    );
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
    });
  });
});

async function readJson<T extends PackageJson | Record<string, string>>(
  relativePath: 'package.json' | 'package.nls.json' | 'package.nls.ja.json',
): Promise<T>;
async function readJson(relativePath: string): Promise<PackageJson | Record<string, string>> {
  const content = await readFile(path.join(repositoryRoot, relativePath), 'utf8');
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

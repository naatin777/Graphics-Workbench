import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { generate, validateManifest } from './generate-extension-meta.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repositoryRoot, 'src/generated/extension_manifest.ts');
const extensionPrefix = 'graphics-workbench.';

void test('old generated metadata files are removed', () => {
  for (const stalePath of ['src/generated-extension-meta.ts', 'src/generated-extension-config.ts']) {
    assert.strictEqual(
      existsSync(path.join(repositoryRoot, stalePath)),
      false,
      `${stalePath} must not remain as a stale generated file`,
    );
  }
});

void test('generated manifest is pure and does not import the VS Code API', () => {
  const content = readFileSync(manifestPath, 'utf8');
  assert.doesNotMatch(content, /from\s+'vscode'/u);
  assert.match(content, /export const publicCommandIds/u);
  assert.match(content, /export type CommandId/u);
  assert.match(content, /export function createConfiguration/u);
  assert.match(content, /export const getDefaultConfiguration/u);
});

void test('generated manifest imports in plain Node without vscode', () => {
  const script = `
    const manifest = await import(${JSON.stringify(manifestPath)});
    if (typeof manifest.getDefaultConfiguration !== 'function') process.exit(1);
    if (typeof manifest.createConfiguration !== 'function') process.exit(2);
    if (!Array.isArray(manifest.publicCommandIds) || manifest.publicCommandIds.length === 0) process.exit(3);
    process.exit(0);
  `;
  execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
});

function createManifest(overrides = {}) {
  return {
    name: 'graphics-workbench',
    publisher: 'naatin777',
    displayName: 'Graphics Workbench',
    version: '1.0.0',
    repository: { type: 'git', url: 'https://github.com/naatin777/Graphics-Workbench' },
    contributes: {
      commands: [
        { command: 'graphics-workbench.convertToPdf', title: '%command.convertToPdf%', category: 'Graphics Workbench' },
      ],
      configuration: {
        properties: {
          'graphics-workbench.externalTools.qpdf.timeoutSeconds': { type: 'integer', default: 0 },
          'graphics-workbench.externalTools.drawio.timeoutSeconds': { type: 'integer', default: 0 },
          'graphics-workbench.contextMenu.enabled': { type: 'boolean', default: true },
        },
      },
      menus: {
        'explorer/context': [
          { command: 'graphics-workbench.convertToPdf', when: 'config.graphics-workbench.contextMenu.enabled' },
        ],
      },
      submenus: [{ id: 'graphics-workbench.convert', label: '%submenu.convert%' }],
    },
    ...overrides,
  };
}

void test('generate emits extension identity, contributions, and tool timeout keys', () => {
  const output = generate(createManifest());

  assert.match(output, /export const extensionIdentity = \{/);
  assert.match(output, /name: 'graphics-workbench'/);
  assert.match(output, /publisher: 'naatin777'/);
  assert.match(output, /id: 'naatin777\.graphics-workbench'/);
  assert.match(output, /configurationNamespace: 'graphics-workbench'/);
  assert.match(output, /export const commandContributions = \{/);
  assert.match(output, /'graphics-workbench\.convertToPdf': \{/);
  assert.match(output, /titleKey: 'command\.convertToPdf'/);
  assert.match(output, /export const publicCommandIds = \[/);
  assert.match(output, /export const submenuContributions = \{/);
  assert.match(output, /labelKey: 'submenu\.convert'/);
  assert.match(output, /export const externalToolTimeoutConfigurationKeys = \{/);
  assert.match(output, /qpdf: 'externalTools\.qpdf\.timeoutSeconds'/);
});

void test('generate accepts a valid manifest', () => {
  assert.doesNotThrow(() => generate(createManifest()));
});

void test('generate rejects commands outside the extension namespace', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      commands: [{ command: 'other.convertToPdf', title: '%command.convertToPdf%' }],
    },
  });

  assert.throws(() => generate(manifest), /outside the extension namespace/);
});

void test('generate rejects configuration keys outside the extension namespace', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      configuration: {
        properties: { 'other.setting': { type: 'string', default: '' } },
      },
    },
  });

  assert.throws(() => generate(manifest), /outside the extension namespace/);
});

void test('generate rejects configuration keys without a default', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      configuration: {
        properties: { 'graphics-workbench.other.setting': { type: 'string' } },
      },
    },
  });

  assert.throws(() => generate(manifest), /missing a default/);
});

void test('validateManifest rejects duplicate command IDs', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      commands: [
        { command: 'graphics-workbench.convertToPdf', title: '%command.convertToPdf%' },
        { command: 'graphics-workbench.convertToPdf', title: '%command.convertToPdf%' },
      ],
    },
  });

  assert.throws(() => validateManifest(manifest, extensionPrefix), /contributes\.commands contains duplicate IDs/);
});

void test('validateManifest rejects duplicate submenu IDs', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      submenus: [
        { id: 'graphics-workbench.convert', label: '%submenu.convert%' },
        { id: 'graphics-workbench.convert', label: '%submenu.convert%' },
      ],
    },
  });

  assert.throws(() => validateManifest(manifest, extensionPrefix), /duplicate IDs/);
});

void test('validateManifest rejects submenu IDs outside the extension namespace', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      submenus: [{ id: 'other.convert', label: '%submenu.convert%' }],
    },
  });

  assert.throws(() => validateManifest(manifest, extensionPrefix), /outside the extension namespace/);
});

void test('validateManifest rejects menu references to undefined commands', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      menus: { commandPalette: [{ command: 'graphics-workbench.missingCommand', when: 'false' }] },
    },
  });

  assert.throws(() => validateManifest(manifest, extensionPrefix), /references undefined command/);
});

void test('validateManifest rejects menu references to undefined submenus', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      menus: { 'explorer/context': [{ submenu: 'graphics-workbench.missingSubmenu' }] },
    },
  });

  assert.throws(() => validateManifest(manifest, extensionPrefix), /references undefined submenu/);
});

void test('validateManifest rejects duplicate entries within a menu', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      menus: {
        commandPalette: [
          { command: 'graphics-workbench.convertToPdf', when: 'false' },
          { command: 'graphics-workbench.convertToPdf', when: 'false' },
        ],
      },
    },
  });

  assert.throws(() => validateManifest(manifest, extensionPrefix), /duplicate entry/);
});

void test('validateManifest rejects when clauses referencing undefined config keys', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      menus: {
        'explorer/context': [
          { command: 'graphics-workbench.convertToPdf', when: 'config.graphics-workbench.missing.enabled' },
        ],
      },
    },
  });

  assert.throws(() => validateManifest(manifest, extensionPrefix), /references undefined config key/);
});

void test('validateManifest rejects when clauses referencing config outside the namespace', () => {
  const manifest = createManifest({
    contributes: {
      ...createManifest().contributes,
      menus: {
        'explorer/context': [{ command: 'graphics-workbench.convertToPdf', when: 'config.other.setting' }],
      },
    },
  });

  assert.throws(() => validateManifest(manifest, extensionPrefix), /outside the namespace/);
});

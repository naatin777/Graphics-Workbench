import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { runVSCodeCommand } from '@vscode/test-electron';

import { requireValue } from '../../../helpers/required.js';

interface PackagedVsixOptions {
  extensionsDir: string;
  userDataDir: string;
  version: string;
  vsixPath: string;
}

export interface InstalledExtension {
  extensionPath: string;
}

export async function installPackagedVsix(options: PackagedVsixOptions): Promise<InstalledExtension> {
  await runVSCodeCommand(
    [
      '--install-extension',
      options.vsixPath,
      '--force',
      `--extensions-dir=${options.extensionsDir}`,
      `--user-data-dir=${options.userDataDir}`,
    ],
    { version: options.version },
  );

  return findInstalledExtension(options.extensionsDir);
}

async function findInstalledExtension(extensionsDir: string): Promise<InstalledExtension> {
  const entries = await readdir(extensionsDir, { withFileTypes: true });
  const matches = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const extensionPath = path.join(extensionsDir, entry.name);
          const manifest = await readManifest(path.join(extensionPath, 'package.json'));

          if (!manifest?.name || !manifest.publisher) {
            return undefined;
          }

          return { extensionPath };
        }),
    )
  ).filter((match): match is InstalledExtension => match !== undefined);

  if (matches.length !== 1) {
    throw new Error(`Expected one installed Graphics Workbench extension, found ${matches.length}.`);
  }

  return requireValue(matches[0]);
}

async function readManifest(manifestPath: string): Promise<{ name?: string; publisher?: string } | undefined> {
  return readFile(manifestPath, 'utf8')
    .then((contents) => JSON.parse(contents) as unknown)
    .then((manifest) => {
      if (typeof manifest !== 'object' || manifest === null) {
        return undefined;
      }
      const name = 'name' in manifest && typeof manifest.name === 'string' ? manifest.name : undefined;
      const publisher =
        'publisher' in manifest && typeof manifest.publisher === 'string' ? manifest.publisher : undefined;
      const result: { name?: string; publisher?: string } = {};
      if (name !== undefined) {
        result.name = name;
      }
      if (publisher !== undefined) {
        result.publisher = publisher;
      }
      return result;
    })
    .catch(() => undefined);
}

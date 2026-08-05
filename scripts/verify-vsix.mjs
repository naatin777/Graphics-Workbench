import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const TARGETS = new Map([
  ['win32-x64', { npmOs: 'win32', npmCpu: 'x64', sharp: 'sharp-win32-x64', libvips: undefined }],
  ['win32-arm64', { npmOs: 'win32', npmCpu: 'arm64', sharp: 'sharp-win32-arm64', libvips: undefined }],
  ['darwin-x64', { npmOs: 'darwin', npmCpu: 'x64', sharp: 'sharp-darwin-x64', libvips: 'sharp-libvips-darwin-x64' }],
  [
    'darwin-arm64',
    { npmOs: 'darwin', npmCpu: 'arm64', sharp: 'sharp-darwin-arm64', libvips: 'sharp-libvips-darwin-arm64' },
  ],
  [
    'linux-x64',
    { npmOs: 'linux', npmCpu: 'x64', libc: 'glibc', sharp: 'sharp-linux-x64', libvips: 'sharp-libvips-linux-x64' },
  ],
  [
    'linux-arm64',
    {
      npmOs: 'linux',
      npmCpu: 'arm64',
      libc: 'glibc',
      sharp: 'sharp-linux-arm64',
      libvips: 'sharp-libvips-linux-arm64',
    },
  ],
]);

const NATIVE_PACKAGE_PREFIX = 'node_modules/@img/';

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function sortStrings(values) {
  return values.toSorted();
}

/**
 * @param {string} target
 */
export function getTargetSpec(target) {
  const spec = TARGETS.get(target);
  if (spec === undefined) {
    throw new Error(`Unsupported VSIX target: ${target}`);
  }
  return spec;
}

/**
 * @param {Buffer} archive
 * @returns {string[]}
 */
export function listZipEntries(archive) {
  const minimumEndRecordOffset = Math.max(0, archive.length - 0xffff - 22);
  let endRecordOffset = -1;
  for (let offset = archive.length - 22; offset >= minimumEndRecordOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      endRecordOffset = offset;
      break;
    }
  }
  if (endRecordOffset < 0) {
    throw new Error('VSIX is not a readable ZIP archive.');
  }

  const centralDirectorySize = archive.readUInt32LE(endRecordOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endRecordOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;

  while (offset < endOffset) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('VSIX has an invalid ZIP central directory.');
    }
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraFieldLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const fileNameStart = offset + 46;
    entries.push(archive.toString('utf8', fileNameStart, fileNameStart + fileNameLength));
    offset += 46 + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

/**
 * @param {string[]} entries
 * @param {string} target
 */
export function verifyVsixEntries(entries, target) {
  const spec = getTargetSpec(target);
  const normalizedEntries = entries.map((entry) =>
    entry.startsWith('extension/') ? entry.slice('extension/'.length) : entry,
  );
  const entrySet = new Set(normalizedEntries);
  const requiredEntries = ['node_modules/sharp/package.json', `${NATIVE_PACKAGE_PREFIX}${spec.sharp}/package.json`];
  if (spec.libvips !== undefined) {
    requiredEntries.push(`${NATIVE_PACKAGE_PREFIX}${spec.libvips}/package.json`);
  }

  const missingEntries = requiredEntries.filter((entry) => !entrySet.has(entry));
  if (missingEntries.length > 0) {
    throw new Error(`VSIX is missing required entries: ${missingEntries.join(', ')}`);
  }

  const nativePackages = normalizedEntries
    .filter((entry) => entry.startsWith(NATIVE_PACKAGE_PREFIX))
    .map((entry) => entry.slice(NATIVE_PACKAGE_PREFIX.length, entry.indexOf('/', NATIVE_PACKAGE_PREFIX.length)))
    .filter((entry) => /^(?:sharp|sharp-libvips)-/u.test(entry));
  const uniqueNativePackages = sortStrings([...new Set(nativePackages)]);
  const expectedNativePackages = new Set([spec.sharp, ...(spec.libvips === undefined ? [] : [spec.libvips])]);
  const unexpectedNativePackages = uniqueNativePackages.filter((entry) => !expectedNativePackages.has(entry));
  if (unexpectedNativePackages.length > 0) {
    throw new Error(`VSIX contains unexpected native packages: ${unexpectedNativePackages.join(', ')}`);
  }

  const devDependencies = readDevDependencyNames(path.join(rootDirectory, 'package.json'));
  const includedDevDependencies = devDependencies.filter((dependency) =>
    entrySet.has(`node_modules/${dependency}/package.json`),
  );
  if (includedDevDependencies.length > 0) {
    throw new Error(`VSIX contains direct devDependencies: ${includedDevDependencies.join(', ')}`);
  }

  return {
    nativePackages: uniqueNativePackages,
    requiredEntries,
    includedDevDependencies,
  };
}

/**
 * @param {string} filePath
 * @returns {string[]}
 */
function readDevDependencyNames(filePath) {
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !('devDependencies' in parsed)) {
    return [];
  }

  const dependencies = parsed.devDependencies;
  if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) {
    return [];
  }
  return Object.keys(dependencies);
}

/**
 * @param {string} target
 * @param {string} nodeModulesDirectory
 */
export function verifySharpInstall(target, nodeModulesDirectory = path.join(rootDirectory, 'node_modules')) {
  const spec = getTargetSpec(target);
  const requiredPackages = ['sharp', spec.sharp, ...(spec.libvips === undefined ? [] : [spec.libvips])];
  const missingPackages = requiredPackages.filter(
    (dependency) =>
      !pathExists(
        path.join(
          nodeModulesDirectory,
          dependency === 'sharp' ? 'sharp' : '@img',
          dependency === 'sharp' ? 'package.json' : `${dependency}/package.json`,
        ),
      ),
  );
  if (missingPackages.length > 0) {
    throw new Error(`Target ${target} is missing installed sharp packages: ${missingPackages.join(', ')}`);
  }
  return requiredPackages;
}

/**
 * @param {string} filePath
 */
function pathExists(filePath) {
  try {
    readFileSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseCliArguments() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'check-install': { type: 'boolean' },
      target: { type: 'string' },
      vsix: { type: 'string' },
    },
    strict: true,
  });
  if (values.target === undefined || (values.vsix === undefined && values['check-install'] !== true)) {
    throw new Error('Usage: node scripts/verify-vsix.mjs --target <target> --vsix <file> [--check-install]');
  }
  return values;
}

if (process.argv.length > 1 && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const values = parseCliArguments();
  const { target } = values;
  if (values['check-install'] === true) {
    const installed = verifySharpInstall(target);
    process.stdout.write(`Installed sharp packages for ${target}: ${installed.join(', ')}\n`);
  }
  if (values.vsix !== undefined) {
    const archive = readFileSync(values.vsix);
    const entries = listZipEntries(archive);
    const result = verifyVsixEntries(entries, target);
    process.stdout.write(
      `${JSON.stringify({ target, entries: entries.length, nativePackages: result.nativePackages }, null, 2)}\n`,
    );
  }
}

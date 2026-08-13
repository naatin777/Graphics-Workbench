import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { getTargetSpec, verifyProductionInstall } from './verify-vsix.mjs';

const rootDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const supportedTargets = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
]);
export const packagingDocumentation = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'README.ja.md',
  'THIRD_PARTY_NOTICES.md',
];

export function getCurrentTarget() {
  const platform = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'win32',
  }[process.platform];
  const architecture = {
    arm64: 'arm64',
    x64: 'x64',
  }[process.arch];

  if (platform === undefined || platform === '' || architecture === undefined || architecture === '') {
    throw new Error(`Unsupported packaging platform: ${process.platform}/${process.arch}`);
  }
  return `${platform}-${architecture}`;
}

/**
 * @param {readonly string[]} args
 */
export function parsePackageArguments(args) {
  const normalizedArgs = args[0] === '--' ? [...args].slice(1) : [...args];
  const { values } = parseArgs({
    args: normalizedArgs,
    options: {
      out: { type: 'string' },
      target: { type: 'string' },
    },
    strict: true,
  });
  const currentTarget = getCurrentTarget();
  const target = values.target ?? currentTarget;

  if (!supportedTargets.has(target)) {
    throw new Error(`Unsupported VSIX target: ${target}`);
  }

  return {
    outputPath: path.resolve(rootDirectory, values.out ?? 'graphics-workbench.vsix'),
    target,
  };
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import('node:child_process').SpawnOptionsWithoutStdio} options
 * @param {{ captureOutput?: boolean }} [behavior]
 * @returns {Promise<string>}
 */
async function runCommand(command, args, options, behavior = {}) {
  return new Promise((resolve, reject) => {
    const captureOutput = behavior.captureOutput === true;
    const child = spawn(command, args, {
      ...options,
      shell: false,
      stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let output = '';
    if (captureOutput) {
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => {
        output += chunk;
      });
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

function getNpmInvocation() {
  if (process.env.npm_execpath !== undefined && process.env.npm_execpath !== '') {
    return { command: process.execPath, prefixArguments: [process.env.npm_execpath] };
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    prefixArguments: [],
  };
}

/**
 * @param {readonly string[]} args
 * @param {import('node:child_process').SpawnOptionsWithoutStdio} options
 * @param {{ captureOutput?: boolean }} [behavior]
 */
async function runNpm(args, options, behavior) {
  const npm = getNpmInvocation();
  return runCommand(npm.command, [...npm.prefixArguments, ...args], options, behavior);
}

/**
 * @param {string} output
 * @param {string} packDirectory
 */
export function parsePackOutput(output, packDirectory) {
  /** @type {unknown} */
  const parsed = JSON.parse(output);
  const items = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null
      ? Object.values(parsed)
      : [];
  if (items.length !== 1) {
    throw new Error('npm pack did not report exactly one package.');
  }
  const [item] = items;
  if (typeof item !== 'object' || item === null || !('filename' in item) || typeof item.filename !== 'string') {
    throw new Error('npm pack did not report a package filename.');
  }
  if (path.basename(item.filename) !== item.filename || !item.filename.endsWith('.tgz')) {
    throw new Error(`npm pack reported an unsafe package filename: ${item.filename}`);
  }
  return path.join(packDirectory, item.filename);
}

/**
 * @param {'core' | 'vscode/extension' | 'vscode/protocol'} workspace
 * @param {string} packDirectory
 * @param {NodeJS.ProcessEnv} environment
 */
async function packWorkspace(workspace, packDirectory, environment) {
  const output = await runNpm(
    ['pack', '--workspace', workspace, '--pack-destination', packDirectory, '--json', '--ignore-scripts'],
    { cwd: rootDirectory, env: environment },
    { captureOutput: true },
  );
  return parsePackOutput(output, packDirectory);
}

/**
 * @param {string} installDirectory
 * @param {string} target
 * @param {string} vscodeTarball
 * @param {string} coreTarball
 * @param {string} protocolTarball
 */
export function getProductionInstallArguments(installDirectory, target, vscodeTarball, coreTarball, protocolTarball) {
  const spec = getTargetSpec(target);
  return [
    'install',
    '--prefix',
    installDirectory,
    '--package-lock=false',
    '--ignore-scripts',
    '--omit=dev',
    '--include=optional',
    '--no-audit',
    '--no-fund',
    '--save=false',
    `--os=${spec.npmOs}`,
    `--cpu=${spec.npmCpu}`,
    ...(spec.libc === undefined ? [] : [`--libc=${spec.libc}`]),
    vscodeTarball,
    coreTarball,
    protocolTarball,
  ];
}

/**
 * Move the extension package and its production dependency tree out of npm's
 * temporary prefix. The resulting directory is a normal VSCE package root and
 * contains no workspace symlinks.
 *
 * @param {string} installDirectory
 * @param {string} stagingDirectory
 */
export async function assembleInstalledExtension(installDirectory, stagingDirectory) {
  const installedNodeModules = path.join(installDirectory, 'node_modules');
  const installedExtension = path.join(installedNodeModules, 'graphics-workbench');
  await rename(installedExtension, stagingDirectory);
  await rename(installedNodeModules, path.join(stagingDirectory, 'node_modules'));
  await rm(path.join(stagingDirectory, 'node_modules', '.package-lock.json'), { force: true });
  await rm(path.join(stagingDirectory, 'node_modules', '.bin'), { recursive: true, force: true });
  return stagingDirectory;
}

/**
 * The workspace tarball has already applied package.json#files. VSCE rejects a
 * package that also has .vscodeignore, so remove the tarball-only allowlist in
 * the disposable staging manifest before applying runtime dependency filters.
 *
 * @param {string} stagingDirectory
 */
export async function prepareStagingManifest(stagingDirectory) {
  const manifestPath = path.join(stagingDirectory, 'package.json');
  /** @type {unknown} */
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Packed VS Code extension manifest must be an object.');
  }
  delete parsed.files;
  await writeFile(manifestPath, `${JSON.stringify(parsed, undefined, 2)}\n`, 'utf8');
}

/**
 * @param {string} stagingDirectory
 */
export async function appendStagingIgnoreRules(stagingDirectory) {
  const ignorePath = path.join(stagingDirectory, '.vscodeignore');
  const existingRules = await readFile(ignorePath, 'utf8');
  await writeFile(
    ignorePath,
    `${existingRules.trimEnd()}\n**/*.tsbuildinfo\nout/core/test/**\nout/vscode/extension/test/**\nout/test-support/**\nout/test/**\n`,
    'utf8',
  );
}

async function copyPackagingMetadata(stagingDirectory) {
  await prepareStagingManifest(stagingDirectory);
  await copyFile(
    path.join(rootDirectory, 'vscode', 'extension', '.vscodeignore'),
    path.join(stagingDirectory, '.vscodeignore'),
  );
  await appendStagingIgnoreRules(stagingDirectory);
  for (const fileName of packagingDocumentation) {
    await copyFile(path.join(rootDirectory, fileName), path.join(stagingDirectory, fileName));
  }
}

/**
 * @param {{ outputPath: string; target: string }} options
 */
export async function packageVsix(options) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-vsix-'));
  try {
    const packDirectory = path.join(temporaryDirectory, 'packages');
    const installDirectory = path.join(temporaryDirectory, 'install');
    const stagingDirectory = path.join(temporaryDirectory, 'extension');
    const npmCacheDirectory = path.join(temporaryDirectory, 'npm-cache');
    const npmEnvironment = { ...process.env, npm_config_cache: npmCacheDirectory };
    await mkdir(packDirectory, { recursive: true });
    await mkdir(installDirectory, { recursive: true });
    await writeFile(path.join(installDirectory, 'package.json'), '{"private":true,"type":"module"}\n', 'utf8');

    const coreTarball = await packWorkspace('core', packDirectory, npmEnvironment);
    const protocolTarball = await packWorkspace('vscode/protocol', packDirectory, npmEnvironment);
    const vscodeTarball = await packWorkspace('vscode/extension', packDirectory, npmEnvironment);
    await runNpm(
      getProductionInstallArguments(installDirectory, options.target, vscodeTarball, coreTarball, protocolTarball),
      {
        cwd: rootDirectory,
        env: npmEnvironment,
      },
    );
    await assembleInstalledExtension(installDirectory, stagingDirectory);
    await copyPackagingMetadata(stagingDirectory);
    verifyProductionInstall(options.target, path.join(stagingDirectory, 'node_modules'));

    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await runCommand(
      process.execPath,
      [
        path.join(rootDirectory, 'node_modules', '@vscode', 'vsce', 'vsce'),
        'package',
        '--target',
        options.target,
        '--out',
        options.outputPath,
      ],
      { cwd: stagingDirectory },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv.length > 1 && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await packageVsix(parsePackageArguments(process.argv.slice(2)));
}

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ElectronApplication, Page, TestInfo } from '@playwright/test';

import { testVscodeSettingsPath } from '../../../helpers/fixture_paths.js';

const execFileAsync = promisify(execFile);
const WINDOWS_REMOVE_TIMEOUT_MS = 10_000;
const WINDOWS_KILL_TIMEOUT_MS = 10_000;
const DISPOSE_HARD_TIMEOUT_MS = 15_000;
const PROCESS_KILL_SETTLE_MS = 250;
const UNIX_PROCESS_LIST_TIMEOUT_MS = 5_000;

interface ElectronTestPaths {
  extensionsDir: string;
  sharedDataDir: string;
  temporaryRoot: string;
  userDataDir: string;
  workspacePath: string;
}

interface ElectronDiagnostics extends ElectronTestPaths {
  consoleMessages: string[];
  error: unknown;
  testInfo: TestInfo;
  window: Page | undefined;
}

export async function writeVscodeUserSettings(
  settingsPath: string,
  colorTheme: string,
  settings: Record<string, unknown> = {},
): Promise<void> {
  const configuredSettings = JSON.parse(
    (await readFile(testVscodeSettingsPath, 'utf8')).replace(/^\uFEFF/u, ''),
  ) as unknown;
  if (!isStringRecord(configuredSettings)) {
    throw new Error(`VS Code test settings must be a JSON object: ${testVscodeSettingsPath}`);
  }
  await resolveMissingExternalToolPaths(configuredSettings);

  await writeFile(
    settingsPath,
    JSON.stringify(
      {
        ...configuredSettings,
        'window.menuStyle': 'custom',
        'window.zoomLevel': 0,
        'workbench.colorTheme': colorTheme,
        'workbench.secondarySideBar.defaultVisibility': 'hidden',
        ...settings,
      },
      undefined,
      2,
    ),
  );
}

/** Fills empty `graphics-workbench.execPath.*` entries from PATH / known app paths, mirroring `.vscode-test.mjs`. */
async function resolveMissingExternalToolPaths(settings: Record<string, unknown>): Promise<void> {
  const tools = [
    ['graphics-workbench.execPath.rsvgConvert', 'rsvg-convert'],
    ['graphics-workbench.execPath.mermaid', 'mmdc'],
    ['graphics-workbench.execPath.drawio', 'drawio'],
  ] as const;

  for (const [key, command] of tools) {
    if (typeof settings[key] === 'string' && settings[key] !== '') {
      continue;
    }
    const resolved =
      key === 'graphics-workbench.execPath.drawio'
        ? ((await resolveExecutablePath(command)) ?? resolveDrawioAppPath())
        : await resolveExecutablePath(command);
    if (resolved !== undefined) {
      settings[key] = resolved;
    }
  }
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function resolveExecutablePath(command: string): Promise<string | undefined> {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(lookupCommand, [command], { encoding: 'utf8' });
    return stdout
      .split(/\r?\n/u)
      .find((line) => line.trim() !== '')
      ?.trim();
  } catch {
    return undefined;
  }
}

function resolveDrawioAppPath(): string | undefined {
  if (process.platform !== 'darwin') {
    return undefined;
  }
  const appPath = '/Applications/draw.io.app/Contents/MacOS/draw.io';
  return existsSync(appPath) ? appPath : undefined;
}

export async function attachElectronDiagnostics({
  consoleMessages,
  error,
  extensionsDir,
  sharedDataDir,
  temporaryRoot,
  testInfo,
  userDataDir,
  window,
  workspacePath,
}: ElectronDiagnostics): Promise<void> {
  const windowScreenshotPath = testInfo.outputPath('vscode-window.png');
  const hasWindowScreenshot = window
    ? await window
        .screenshot({ path: windowScreenshotPath })
        .then(() => true)
        .catch(() => false)
    : false;

  if (hasWindowScreenshot) {
    await testInfo.attach('vscode-window', {
      path: windowScreenshotPath,
      contentType: 'image/png',
    });
  }

  const windowTitle = window ? await window.title().catch(() => '<unavailable>') : '<unavailable>';
  const windowText = window
    ? await window
        .locator('body')
        .innerText()
        .catch(() => '<unavailable>')
    : '<window unavailable>';
  const frameDiagnostics = window
    ? await Promise.all(
        window.frames().map(async (frame, index) => {
          const bodyText = await frame
            .locator('body')
            .innerText()
            .catch(() => '<unavailable>');

          return `frame[${index}] url: ${frame.url()}\n${bodyText.slice(0, 6000)}`;
        }),
      )
    : ['<window unavailable>'];
  const errorMessage = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  const diagnostics = [
    `error:\n${errorMessage}`,
    `temporaryRoot: ${temporaryRoot}`,
    `workspacePath: ${workspacePath}`,
    `userDataDir: ${userDataDir}`,
    `sharedDataDir: ${sharedDataDir}`,
    `extensionsDir: ${extensionsDir}`,
    `windowTitle: ${windowTitle}`,
    `windowUrl: ${window?.url() ?? '<unavailable>'}`,
    `windowText:\n${windowText.slice(0, 12000)}`,
    `frames:\n${frameDiagnostics.join('\n\n')}`,
    `electronConsole:\n${consoleMessages.join('\n') || '<empty>'}`,
  ].join('\n\n');
  const diagnosticsPath = testInfo.outputPath('vscode-electron-diagnostic.txt');

  await writeFile(diagnosticsPath, diagnostics);
  await testInfo.attach('vscode-electron-diagnostic', {
    path: diagnosticsPath,
    contentType: 'text/plain',
  });

  const logsPath = testInfo.outputPath('vscode-extension-host-log.txt');
  await writeFile(logsPath, await readVSCodeLogs(join(userDataDir, 'logs')));
  await testInfo.attach('vscode-extension-host-log', {
    path: logsPath,
    contentType: 'text/plain',
  });
}

export async function disposeElectronTest(
  electronApp: ElectronApplication | undefined,
  temporaryRoot: string,
): Promise<void> {
  const isWindows = process.platform === 'win32';
  const parentPid = electronApp?.process().pid;

  try {
    await withHardTimeout('dispose Electron test', DISPOSE_HARD_TIMEOUT_MS, async () => {
      try {
        if (!electronApp) {
          return;
        }

        const electronProcess = electronApp.process();
        await terminateElectronProcess(electronProcess);
      } finally {
        await removeTemporaryRoot(temporaryRoot);
      }
    });
  } catch (error) {
    // A stuck Electron process must never block the runner; force-kill the tree.
    if (parentPid !== undefined) {
      await forceKillProcessTree(parentPid);
    }
    throw error instanceof Error ? error : new Error(String(error));
  }

  if (!isWindows && (await pathExists(temporaryRoot))) {
    throw new Error(`Electron test temporary directory was not removed: ${temporaryRoot}`);
  }
}

async function removeTemporaryRoot(temporaryRoot: string): Promise<void> {
  if (process.platform === 'win32') {
    await removeWindowsTemporaryRoot(temporaryRoot);
    return;
  }

  await rm(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 200,
  });
}

async function removeWindowsTemporaryRoot(temporaryRoot: string): Promise<void> {
  await execFileAsync('cmd.exe', ['/d', '/s', '/c', `rd /s /q "${temporaryRoot}"`], {
    timeout: WINDOWS_REMOVE_TIMEOUT_MS,
    windowsHide: true,
  }).then(
    () => undefined,
    () => undefined,
  );

  if (!(await pathExists(temporaryRoot))) {
    return;
  }

  // Large VSIX trees can take minutes to delete on Windows even after every
  // VS Code process has exited. The runner workspace is ephemeral, so defer a
  // final native retry instead of consuming the Playwright test timeout.
  const cleaner = spawn('cmd.exe', ['/d', '/s', '/c', `ping 127.0.0.1 -n 3 >nul & rd /s /q "${temporaryRoot}"`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  cleaner.unref();
}

async function readVSCodeLogs(logRoot: string): Promise<string> {
  const entries = await readLogFiles(logRoot);

  if (entries.length === 0) {
    return `No VS Code logs were found in ${logRoot}.\n`;
  }

  return entries.join('\n\n');
}

async function readLogFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return readLogFiles(entryPath);
      }
      if (!entry.isFile()) {
        return [];
      }

      const content = await readFile(entryPath, 'utf8').catch(() => '<unreadable>');
      return [`${entryPath}:\n${content.slice(0, 64_000)}`];
    }),
  );

  return contents.flat();
}

async function terminateElectronProcess(electronProcess: ReturnType<ElectronApplication['process']>): Promise<void> {
  const { pid } = electronProcess;

  if (pid === undefined) {
    return;
  }

  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      timeout: WINDOWS_KILL_TIMEOUT_MS,
      windowsHide: true,
    }).then(
      () => undefined,
      () => undefined,
    );
    return;
  }

  // A graceful VS Code quit can open native save/quit prompts unrelated to the product.
  // Test data is disposable, so kill the complete process tree directly.
  const descendantPids = await findDescendantPids(pid);
  signalProcess(pid, 'SIGKILL');
  signalProcessTree(descendantPids, 'SIGKILL');
  await waitForProcessTreeExit([pid, ...descendantPids], PROCESS_KILL_SETTLE_MS);
}

async function forceKillProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      timeout: WINDOWS_KILL_TIMEOUT_MS,
      windowsHide: true,
    }).then(
      () => undefined,
      () => undefined,
    );
    return;
  }

  const descendantPids = await findDescendantPids(pid);
  signalProcess(pid, 'SIGKILL');
  signalProcessTree(descendantPids, 'SIGKILL');
}

async function findDescendantPids(rootPid: number): Promise<number[]> {
  const processTable = await execFileAsync('ps', ['-axo', 'pid=,ppid='], {
    timeout: UNIX_PROCESS_LIST_TIMEOUT_MS,
  }).catch(() => ({ stdout: '' }));
  const childrenByParent = new Map<number, number[]>();

  for (const line of processTable.stdout.split('\n')) {
    const [pidText, parentPidText] = line.trim().split(/\s+/u);
    const pid = Number(pidText);
    const parentPid = Number(parentPidText);

    if (!Number.isInteger(pid) || !Number.isInteger(parentPid) || pid <= 0 || parentPid < 0) {
      continue;
    }

    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }

  const descendants: number[] = [];
  const pending = [rootPid];
  const visited = new Set<number>(pending);

  while (pending.length > 0) {
    const parentPid = pending.shift();
    if (parentPid === undefined) {
      break;
    }

    for (const childPid of childrenByParent.get(parentPid) ?? []) {
      if (visited.has(childPid)) {
        continue;
      }

      visited.add(childPid);
      descendants.push(childPid);
      pending.push(childPid);
    }
  }

  return descendants.toReversed();
}

function signalProcessTree(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    signalProcess(pid, signal);
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // The process exited between process discovery and signaling.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessTreeExit(pids: number[], milliseconds: number): Promise<void> {
  const deadline = Date.now() + milliseconds;

  while (pids.some(isProcessAlive) && Date.now() < deadline) {
    await timeout(100);
  }
}

function timeout(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function withHardTimeout<T>(label: string, milliseconds: number, callback: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      callback(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${milliseconds}ms.`));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}

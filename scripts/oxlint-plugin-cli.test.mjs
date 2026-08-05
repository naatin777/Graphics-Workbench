import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const worktreeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oxlintEntry = path.join(worktreeRoot, 'node_modules', 'oxlint', 'bin', 'oxlint');
const oxlintConfig = path.join(worktreeRoot, 'oxlint.config.ts');

const fixtures = {
  'conditional_spreads.ts': `declare const hasTitle: boolean;
declare const hasMeta: boolean;

export function buildOptionsWithLimit(): Record<string, unknown> {
  return {
    ...(hasTitle && { title: 'hello' }),
    ...(hasMeta && { meta: 'published' }),
  };
}

export function buildOptionsSingle(): Record<string, unknown> {
  return {
    ...(hasTitle && { title: 'hello' }),
    title: 'fallback',
  };
}
`,
  'flat_type.ts': `export interface FlatFileOptions {
  previewTitle: string;
  previewDescription: string;
  previewAriaLabel: string;
  renderPath: string;
  renderName: string;
  renderScale: number;
  renderDpi: number;
  inputPath: string;
  outputPath: string;
  sourcePath: string;
  destPath: string;
}

export interface NestedFileOptions {
  previewTitle: string;
  previewDescription: string;
  renderPath: string;
  inputPath: string;
  outputPath: string;
}
`,
  'raster_bypass.ts': `import { readFile } from 'node:fs/promises';

import sharp from 'sharp';

declare const sourceBuffer: Buffer;
declare const sourcePath: string;

export function openWithLimitDisabled(): void {
  void sharp(sourcePath, { limitInputPixels: false });
}

export function openWithChannels(): void {
  void sharp(sourcePath, { limitInputChannels: 3 });
}

export function openBufferWithLimit(): void {
  void sharp(sourceBuffer, { limitInputPixels: false });
}

export async function openReadFileWithLimit(): Promise<void> {
  void sharp(await readFile(sourcePath), { limitInputPixels: false });
}

export function openSharedHelper(): void {
  void sharp(sourcePath, { limitInputPixels: 1000 });
}

export function createImageWithAlias(): void {
  const makeImage = sharp;
  void makeImage(sourcePath, { limitInputPixels: false });
}
`,
  'e2e_wait.ts': `export async function waitForLoad(page: { waitForTimeout: (ms: number) => Promise<void> }): Promise<void> {
  await page.waitForTimeout(1000);
}

export async function waitForVisible(page: { waitFor: (selector: string) => Promise<void> }): Promise<void> {
  await page.waitFor('.ready');
}
`,
  'secret_log.ts': `type OutputChannel = {
  appendLine: (line: string) => void;
};

declare const jobJsonPath: string;
declare const requestId: string;

export function logJobJsonPath(channel: OutputChannel): void {
  channel.appendLine('job output: ' + jobJsonPath);
}

export function logRequestId(channel: OutputChannel): void {
  channel.appendLine('request output: ' + requestId);
}
`,
  'child_process_violates.ts': `import { exec } from 'node:child_process';

export function run(): void {
  void exec;
}
`,
  'child_process_clean.ts': `import { readFile } from 'node:fs/promises';

export function load(sourcePath: string): Promise<string> {
  return readFile(sourcePath, 'utf8');
}
`,
  'child_process_dynamic.ts': `export async function load(): Promise<unknown> {
  return await import('node:child_process');
}
`,
  'src/operations/pdf/crop_pdf_process_protocol.ts': `export interface CropPdfProcessFailure {
  type: 'failure';
  message: string;
}

export interface CropPdfProcessSuccess {
  type: 'success';
  protocolVersion: number;
  requestId: string;
}

export interface CropPdfProcessStarted {
  type: 'started';
  protocolVersion?: number;
  requestId: string;
}

export type CropPdfProcessProgress =
  | { type: 'progress'; protocolVersion: number; requestId: string }
  | { type: 'progress-detail'; protocolVersion: number; requestId: string };
`,
  'src/operations/pdf/crop_pdf_payload_process_protocol.ts': `export interface CropPdfProcessRequest {
  type: 'request';
  protocolVersion: number;
  requestId: string;
  inputPath: string;
}

export interface CropPdfProcessPayload {
  type: 'payload';
  protocolVersion: number;
  requestId: string;
  pdfBytes: Uint8Array;
}

export interface CropPdfProcessStream {
  type: 'stream';
  protocolVersion: number;
  requestId: string;
  data: Uint8Array;
}
`,
  'src/operations/pdf/crop_pdf_core.ts': `export interface CropPdfProcessFailure {
  type: 'failure';
  message: string;
}
`,
  'webview/apps/crop_pdf/src/listener_cleanup_violates.ts': `function handleMessage(event: MessageEvent): void {
  void event.data;
}

export function setup(): void {
  window.addEventListener('message', handleMessage);
}
`,
  'webview/apps/crop_pdf/src/listener_cleanup_clean.ts': `function handleMessage(event: MessageEvent): void {
  void event.data;
}

export function setup(): void {
  window.addEventListener('message', handleMessage);
  window.removeEventListener('message', handleMessage);
}
`,
  'webview/apps/crop_pdf/src/api_bypass.ts': `export function sendMessage(message: unknown): void {
  const api = acquireVsCodeApi();
  void api.postMessage(message);
}
`,
  'webview/apps/crop_pdf/src/api_clean.ts': `type VscodeApi = {
  sendMessage: (message: unknown) => void;
};

export function notifyReady(vscode: VscodeApi, message: unknown): void {
  vscode.sendMessage(message);
}
`,
  'webview/apps/crop_pdf/src/vscode.ts': `declare const acquireVsCodeApi: () => { postMessage: (message: unknown) => void };

export const vscode = {
  sendMessage(message: unknown): void {
    void acquireVsCodeApi().postMessage(message);
  },
};
`,
  'webview/shared/vscode.ts': `function handleMessage(event: MessageEvent): void {
  void event.data;
}

export function registerListener(): void {
  window.addEventListener('message', handleMessage);
}
`,
};

function writeFixtures(root) {
  const files = [];
  for (const [relative, content] of Object.entries(fixtures)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    files.push(absolute);
  }
  return files;
}

function runOxlint(files) {
  const result = spawnSync(process.execPath, [oxlintEntry, '--config', oxlintConfig, '--format', 'json', ...files], {
    cwd: worktreeRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  const stdout = result.stdout ?? '';
  try {
    return JSON.parse(stdout).diagnostics;
  } catch {
    throw new Error(
      `oxlint produced non-JSON output (exit status ${String(result.status)}).\nstdout:\n${stdout}\nstderr:\n${result.stderr ?? ''}`,
    );
  }
}

function ruleIdOf(diagnostic) {
  const match = /\(([^()]+)\)$/u.exec(diagnostic.code);
  return match === null ? diagnostic.code : match[1];
}

const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'oxlint-plugin-cli-'));

let diagnostics;
try {
  diagnostics = runOxlint(writeFixtures(fixtureRoot));
} catch (error) {
  rmSync(fixtureRoot, { recursive: true, force: true });
  throw new Error(`oxlint fixture setup or run failed: ${String(error)}`, { cause: error });
}

after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function projectRuleLines(relativeFile, ruleId) {
  const absolute = path.resolve(fixtureRoot, relativeFile);
  return diagnostics
    .filter((diagnostic) => path.resolve(diagnostic.filename) === absolute && ruleIdOf(diagnostic) === ruleId)
    .flatMap((diagnostic) => diagnostic.labels.map((label) => label.span.line))
    .toSorted((left, right) => left - right);
}

const expectations = [
  {
    ruleId: 'max-conditional-spreads-per-object',
    cases: [{ file: 'conditional_spreads.ts', lines: [7] }],
  },
  {
    ruleId: 'max-flat-type-members',
    cases: [{ file: 'flat_type.ts', lines: [1] }],
  },
  {
    ruleId: 'forbid-raster-input-limit-bypass',
    cases: [{ file: 'raster_bypass.ts', lines: [9, 13, 17, 21, 30] }],
  },
  {
    ruleId: 'no-fixed-e2e-wait',
    cases: [{ file: 'e2e_wait.ts', lines: [2] }],
  },
  {
    ruleId: 'no-secret-output-log',
    cases: [{ file: 'secret_log.ts', lines: [9] }],
  },
  {
    ruleId: 'no-direct-child-process',
    cases: [
      { file: 'child_process_violates.ts', lines: [1] },
      { file: 'child_process_dynamic.ts', lines: [2] },
      { file: 'child_process_clean.ts', lines: [] },
    ],
  },
  {
    ruleId: 'require-webview-listener-cleanup',
    cases: [
      { file: 'webview/apps/crop_pdf/src/listener_cleanup_violates.ts', lines: [6] },
      { file: 'webview/apps/crop_pdf/src/listener_cleanup_clean.ts', lines: [] },
      { file: 'webview/shared/vscode.ts', lines: [] },
    ],
  },
  {
    ruleId: 'no-webview-api-bypass',
    cases: [
      { file: 'webview/apps/crop_pdf/src/api_bypass.ts', lines: [2, 3] },
      { file: 'webview/apps/crop_pdf/src/api_clean.ts', lines: [] },
      { file: 'webview/apps/crop_pdf/src/vscode.ts', lines: [] },
    ],
  },
  {
    ruleId: 'require-process-envelope',
    cases: [
      { file: 'src/operations/pdf/crop_pdf_process_protocol.ts', lines: [1] },
      { file: 'src/operations/pdf/crop_pdf_payload_process_protocol.ts', lines: [] },
      { file: 'src/operations/pdf/crop_pdf_core.ts', lines: [] },
    ],
  },
  {
    ruleId: 'no-pdf-bytes-in-process-ipc',
    cases: [
      { file: 'src/operations/pdf/crop_pdf_payload_process_protocol.ts', lines: [12, 19] },
      { file: 'src/operations/pdf/crop_pdf_process_protocol.ts', lines: [] },
    ],
  },
];

for (const expectation of expectations) {
  void test(`project/${expectation.ruleId} through the oxlint CLI`, () => {
    for (const { file, lines } of expectation.cases) {
      const message = `${file} for project/${expectation.ruleId}`;
      assert.deepStrictEqual(projectRuleLines(file, expectation.ruleId), lines, message);
    }
  });
}

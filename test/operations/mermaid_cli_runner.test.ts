// Test target:
// - runMermaidCliWithSignalが子プロセスのMermaid CLIへ描画させ、成功時にresolveすること
// - キャンセル要求で子プロセスを終了し、AbortErrorとしてrejectすること
// - タイムアウトで子プロセスを終了し、timeoutエラーとしてrejectすること
//
// Mocked:
// - なし。実ブラウザを使用して実際に描画する
//
// Not tested:
// - 変換コマンド全体の進捗・通知UI
// - runExternalToolのタイムアウト

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { testInputDirectory } from '../helpers/fixture_paths.js';
import { runMermaidCliWithSignal } from '../../src/operations/conversion/tools/run_mermaid_cli.js';

const operationMermaidInputPath = path.join(testInputDirectory, 'valid', 'mermaid', 'conversion-flowchart.mmd');

suite('Mermaid CLIのキャンセルとタイムアウト', () => {
  test('子プロセスのMermaid CLIでSVGを描画できる', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-workspace-'));
    const sourcePath = path.join(workspacePath, 'input.mmd');
    const outputPath = path.join(workspacePath, 'output.svg');

    try {
      await writeFile(sourcePath, await readFile(operationMermaidInputPath));

      await runMermaidCliWithSignal({
        sourcePath,
        outputPath,
        outputFormat: 'svg',
        puppeteerConfig: { headless: true, channel: 'chrome' },
        theme: 'default',
        backgroundColor: 'white',
      });

      const svg = await readFile(outputPath, 'utf8');
      assert.ok(svg.includes('<svg'));
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('キャンセル済みのsignalでは子プロセスを起動せずAbortErrorでrejectする', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-workspace-'));
    const sourcePath = path.join(workspacePath, 'input.mmd');
    const outputPath = path.join(workspacePath, 'output.svg');

    try {
      await writeFile(sourcePath, await readFile(operationMermaidInputPath));
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        runMermaidCliWithSignal(
          {
            sourcePath,
            outputPath,
            outputFormat: 'svg',
            puppeteerConfig: { headless: true, channel: 'chrome' },
            theme: 'default',
            backgroundColor: 'white',
          },
          controller.signal,
          10_000,
        ),
        /cancelled/,
      );
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('描画中のキャンセルで子プロセスを終了してAbortErrorでrejectする', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-workspace-'));
    const sourcePath = path.join(workspacePath, 'input.mmd');
    const outputPath = path.join(workspacePath, 'output.svg');

    try {
      await writeFile(sourcePath, await readFile(operationMermaidInputPath));
      const controller = new AbortController();
      const pending = runMermaidCliWithSignal(
        {
          sourcePath,
          outputPath,
          outputFormat: 'svg',
          puppeteerConfig: { headless: true, channel: 'chrome' },
          theme: 'default',
          backgroundColor: 'white',
        },
        controller.signal,
        10_000,
      );
      setTimeout(() => {
        controller.abort();
      }, 300);

      await assert.rejects(pending, /cancelled/);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('タイムアウトで子プロセスを終了してtimeoutエラーでrejectする', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-workspace-'));
    const sourcePath = path.join(workspacePath, 'input.mmd');
    const outputPath = path.join(workspacePath, 'output.svg');

    try {
      await writeFile(sourcePath, await readFile(operationMermaidInputPath));

      await assert.rejects(
        runMermaidCliWithSignal(
          {
            sourcePath,
            outputPath,
            outputFormat: 'svg',
            puppeteerConfig: { headless: true, channel: 'chrome' },
            theme: 'default',
            backgroundColor: 'white',
          },
          undefined,
          100,
        ),
        /timed out/,
      );
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

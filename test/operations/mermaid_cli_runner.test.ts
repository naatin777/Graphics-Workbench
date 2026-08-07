// Test target:
// - Mermaid rendering runs the bundled mmdc CLI as an external process.
// - CLI arguments carry output, theme/background settings, and temporary config files separately.
// - a pre-aborted signal avoids spawning mmdc; in-flight termination is covered by run_external_tool tests.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getExtensionConfiguration } from '../../src/config/extension_configuration.js';
import { readMermaidExecutablePath } from '../../src/config/external_tools/external_tool_paths.js';
import { readChromeExecutablePath } from '../../src/config/rendering/mermaid_cli_options.js';
import { testInputDirectory } from '../helpers/fixture_paths.js';
import {
  createMermaidCliArgs,
  runMermaidCliWithSignal,
  type MermaidCliRunRequest,
} from '../../src/operations/conversion/tools/run_mermaid_cli.js';

const operationMermaidInputPath = path.join(testInputDirectory, 'valid', 'mermaid', 'conversion-flowchart.mmd');

suite('mmdc CLI実行', () => {
  test('mmdcでSVGを描画できる', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-workspace-'));
    const sourcePath = path.join(workspacePath, 'input.mmd');
    const outputPath = path.join(workspacePath, 'output.svg');

    try {
      await writeFile(sourcePath, await readFile(operationMermaidInputPath));
      await runMermaidCliWithSignal({
        sourcePath,
        outputPath,
        outputFormat: 'svg',
        mermaidPath: readMermaidExecutablePath(getExtensionConfiguration()),
        chromePath: readChromeExecutablePath(getExtensionConfiguration()),
        theme: 'default',
        backgroundColor: 'white',
      });

      const svg = await readFile(outputPath, 'utf8');
      assert.ok(svg.includes('<svg'));
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('キャンセル済みのsignalではmmdcを起動せずAbortErrorでrejectする', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(runMermaidCliWithSignal(createTestRequest(), controller.signal), /aborted|cancelled/iu);
  });

  test('CLI引数はinput/outputと一時設定fileを別の引数で渡す', () => {
    const args = createMermaidCliArgs(createTestRequest(), '/tmp/mermaid.json', '/tmp/chrome.json');

    assert.deepStrictEqual(args, [
      '--input',
      '/workspace/input.mmd',
      '--output',
      '/workspace/output.svg',
      '--outputFormat',
      'svg',
      '--backgroundColor',
      'white',
      '--configFile',
      '/tmp/mermaid.json',
      '--puppeteerConfigFile',
      '/tmp/chrome.json',
      '--quiet',
    ]);
  });
});

function createTestRequest(): MermaidCliRunRequest {
  return {
    sourcePath: '/workspace/input.mmd',
    outputPath: '/workspace/output.svg',
    outputFormat: 'svg',
    mermaidPath: 'mmdc',
    chromePath: 'chrome',
    theme: 'default',
    backgroundColor: 'white',
  };
}

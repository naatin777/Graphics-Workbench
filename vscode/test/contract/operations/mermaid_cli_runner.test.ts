// Test target:
// - Mermaid rendering runs the externally installed/configured mmdc CLI as an external process.
// - CLI arguments carry output, theme/background settings, and temporary config files separately.
// - a pre-aborted signal avoids spawning mmdc; in-flight termination is covered by run_external_tool tests.

import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getExtensionConfiguration } from '../../../src/config/extension_configuration.js';
import { resolveChromeExecutablePath } from '../../../src/config/rendering/mermaid_cli_options.js';
import { testInputDirectory } from '../../support/helpers/fixture_paths.js';
import {
  createMermaidCliArgs,
  runMermaidCliWithSignal,
  type MermaidCliRunRequest,
} from '@graphics-workbench/core/operations/conversion/tools/run_mermaid_cli.js';

const operationMermaidInputPath = path.join(testInputDirectory, 'valid', 'mermaid', 'conversion-flowchart.mmd');

suite('mmdc CLI実行', () => {
  test('mermaidテスト入力を入力としてmmdcを外部プロセス起動してSVG描画し、出力SVGに<svg要素が含まれる', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-mermaid-workspace-'));
    const sourcePath = path.join(workspacePath.path, 'input.mmd');
    const outputPath = path.join(workspacePath.path, 'output.svg');

    await writeFile(sourcePath, await readFile(operationMermaidInputPath));
    await runMermaidCliWithSignal(
      {
        sourcePath,
        outputPath,
        outputFormat: 'svg',
        mermaidPath: getExtensionConfiguration().execPath.mermaid(),
        chromePath: resolveChromeExecutablePath(getExtensionConfiguration()),
        theme: 'default',
        backgroundColor: 'white',
      },
      new AbortController().signal,
    );

    const svg = await readFile(outputPath, 'utf8');
    assert.ok(svg.includes('<svg'));
  });

  test('abort済みsignalでmmdc実行を呼ぶと、mmdcプロセスを起動せずにaborted/cancelledのエラーでrejectする', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(runMermaidCliWithSignal(createTestRequest(), controller.signal), /aborted|cancelled/iu);
  });

  test('CLI引数が、--input/--outputの変換対象と--configFile/--puppeteerConfigFileの一時設定ファイルを別々の引数として組み立てられる', () => {
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

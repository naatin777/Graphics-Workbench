// Test target:
// - Controlsが表示する機能単位のavailabilityを1回のprobe snapshotから構築すること
// - 選択中のSVG backendだけを確認し、別backendへfallbackしないこと
// - 利用できない外部toolに対応するsetting IDを返すこと
// - ENOENT / timeout / 一般的な失敗を利用者向けdetailへ変換すること
//
// Mocked:
// - probe関数を注入して外部ツール実行を模擬する
//
// Not tested:
// - 実際の外部ツールの実行
// - ControlsのVS Code Settings遷移（controls_panel.test.tsで確認）

import assert from 'node:assert/strict';

import {
  runFeatureAvailabilityChecks,
  type FeatureAvailabilityEntry,
} from '../../vscode/src/commands/shared/environment_check.js';
import { userMessage } from '../../vscode/src/commands/shared/user_messages.js';
import { fakeConfiguration } from '../helpers/configuration.js';

type Probe = (params: { toolName: string }) => Promise<void>;

const TOOL_DRAWIO = userMessage('message.environmentCheck.tool.drawio');
const TOOL_RSVG = userMessage('message.environmentCheck.tool.rsvgConvert');
const TOOL_BROWSER = userMessage('message.environmentCheck.tool.browser');
const TOOL_MERMAID = userMessage('message.environmentCheck.tool.mermaidCli');

function checkWithProbe(probe: Probe, overrides: Record<string, unknown> = {}): Promise<FeatureAvailabilityEntry[]> {
  return runFeatureAvailabilityChecks({
    configuration: fakeConfiguration(overrides),
    probe,
  });
}

function entryMap(entries: FeatureAvailabilityEntry[]): Map<string, FeatureAvailabilityEntry> {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function notFound(toolName: string): Error {
  return Object.assign(new Error(`spawn ${toolName} ENOENT`), { code: 'ENOENT' });
}

suite('Controlsの機能availabilityを構築する外部tool probe', () => {
  test('PDF operationsとImagesは外部toolに依存せず常に利用可能と判定する', async () => {
    const map = entryMap(await checkWithProbe(async () => {}));

    assert.deepStrictEqual(map.get('pdf-operations'), {
      id: 'pdf-operations',
      available: true,
      detail: userMessage('message.environmentCheck.available'),
    });
    assert.strictEqual(map.get('images')?.available, true);
  });

  test('ChromeがSVG backendの場合はMermaidとSVGで同じbrowser probeを共有し、1回だけ起動する', async () => {
    const probed: string[] = [];

    const map = entryMap(
      await checkWithProbe(async ({ toolName }) => {
        probed.push(toolName);
      }),
    );

    assert.strictEqual(probed.filter((toolName) => toolName === TOOL_BROWSER).length, 1);
    assert.strictEqual(map.get('svg-to-pdf')?.settingId, 'graphics-workbench.execPath.chrome');
    assert.strictEqual(map.get('mermaid')?.available, true);
  });

  test('rsvg-convertが選択されている場合はSVG用にrsvgだけを追加probeし、失敗してもChromeへfallbackしない', async () => {
    const probed: string[] = [];
    const map = entryMap(
      await checkWithProbe(
        async ({ toolName }) => {
          probed.push(toolName);
          if (toolName === TOOL_RSVG) {
            throw notFound(toolName);
          }
        },
        { 'convertToPdf.svg.engine': 'rsvg-convert' },
      ),
    );

    assert.strictEqual(map.get('svg-to-pdf')?.available, false);
    assert.strictEqual(map.get('svg-to-pdf')?.settingId, 'graphics-workbench.execPath.rsvgConvert');
    assert.strictEqual(map.get('mermaid')?.available, true);
    assert.strictEqual(probed.filter((toolName) => toolName === TOOL_RSVG).length, 1);
    assert.strictEqual(probed.filter((toolName) => toolName === TOOL_BROWSER).length, 1);
  });

  test('Draw.ioが見つからない場合はローカルpathをdetailへ漏らさずDraw.io settingを返す', async () => {
    const map = entryMap(
      await checkWithProbe(async ({ toolName }) => {
        if (toolName === TOOL_DRAWIO) {
          throw Object.assign(new Error('spawn /Users/me/private/drawio ENOENT'), { code: 'ENOENT' });
        }
      }),
    );

    const drawio = map.get('drawio');
    assert.deepStrictEqual(drawio, {
      id: 'drawio',
      available: false,
      detail: userMessage('message.environmentCheck.notFound', TOOL_DRAWIO),
      settingId: 'graphics-workbench.execPath.drawio',
    });
    assert.ok(!drawio?.detail.includes('/Users/me/private'));
  });

  test('Mermaid CLIが無い場合はmermaid settingを返し、CLIが使えてChromeが無い場合はchrome settingを返す', async () => {
    const missingCli = entryMap(
      await checkWithProbe(async ({ toolName }) => {
        if (toolName === TOOL_MERMAID) {
          throw notFound(toolName);
        }
      }),
    );
    assert.strictEqual(missingCli.get('mermaid')?.available, false);
    assert.strictEqual(missingCli.get('mermaid')?.settingId, 'graphics-workbench.execPath.mermaid');

    const missingChrome = entryMap(
      await checkWithProbe(async ({ toolName }) => {
        if (toolName === TOOL_BROWSER) {
          throw notFound(toolName);
        }
      }),
    );
    assert.strictEqual(missingChrome.get('mermaid')?.available, false);
    assert.strictEqual(missingChrome.get('mermaid')?.settingId, 'graphics-workbench.execPath.chrome');
  });

  test('timeoutと一般的な起動失敗を利用不可detailへ変換する', async () => {
    const timedOut = entryMap(
      await checkWithProbe(async ({ toolName }) => {
        if (toolName === TOOL_MERMAID) {
          throw new Error('mmdc timed out after 10000ms');
        }
      }),
    );
    assert.strictEqual(timedOut.get('mermaid')?.detail, userMessage('message.environmentCheck.timedOut', TOOL_MERMAID));

    const failed = entryMap(
      await checkWithProbe(async ({ toolName }) => {
        if (toolName === TOOL_DRAWIO) {
          throw new Error('exit 2');
        }
      }),
    );
    assert.strictEqual(
      failed.get('drawio')?.detail,
      userMessage('message.environmentCheck.failed', TOOL_DRAWIO, 'exit 2'),
    );
  });
});

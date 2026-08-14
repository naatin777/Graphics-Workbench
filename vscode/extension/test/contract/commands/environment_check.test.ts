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
} from '../../../src/commands/shared/environment_check.js';
import { userMessage } from '../../../src/commands/shared/user_messages.js';
import { fakeConfiguration } from '../../support/helpers/configuration.js';

type Probe = (params: { toolName: string }) => Promise<void>;

const TOOL_DRAWIO = userMessage('message.environmentCheck.tool.drawio');
const TOOL_RSVG = userMessage('message.environmentCheck.tool.rsvgConvert');
const TOOL_BROWSER = userMessage('message.environmentCheck.tool.browser');

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

  test('ChromeがSVG backendの場合はSVGと同じbrowser probeを共有し、1回だけ起動する', async () => {
    const probed: string[] = [];

    const map = entryMap(
      await checkWithProbe(
        async ({ toolName }) => {
          probed.push(toolName);
        },
        { 'execPath.chrome': 'chrome-path' },
      ),
    );

    assert.strictEqual(probed.filter((toolName) => toolName === TOOL_BROWSER).length, 1);
    assert.strictEqual(map.get('svg-to-pdf')?.settingId, 'graphics-workbench.execPath.chrome');
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
        {
          'convertToPdf.svg.engine': 'rsvg-convert',
          'execPath.rsvgConvert': 'rsvg-path',
          'execPath.chrome': 'chrome-path',
        },
      ),
    );

    assert.strictEqual(map.get('svg-to-pdf')?.available, false);
    assert.strictEqual(map.get('svg-to-pdf')?.settingId, 'graphics-workbench.execPath.rsvgConvert');
    assert.strictEqual(probed.filter((toolName) => toolName === TOOL_RSVG).length, 1);
    assert.strictEqual(probed.filter((toolName) => toolName === TOOL_BROWSER).length, 1);
  });

  test('Draw.ioが見つからない場合はローカルpathをdetailへ漏らさずDraw.io settingを返す', async () => {
    const map = entryMap(
      await checkWithProbe(
        async ({ toolName }) => {
          if (toolName === TOOL_DRAWIO) {
            throw Object.assign(new Error('spawn LOCAL_DRAWIO_PATH ENOENT'), { code: 'ENOENT' });
          }
        },
        { 'execPath.drawio': 'drawio-path' },
      ),
    );

    const drawio = map.get('drawio');
    assert.deepStrictEqual(drawio, {
      id: 'drawio',
      available: false,
      detail: userMessage('message.environmentCheck.notFound', TOOL_DRAWIO),
      settingId: 'graphics-workbench.execPath.drawio',
    });
    assert.ok(!drawio?.detail.includes('LOCAL_DRAWIO_PATH'));
  });

  test('execPath未設定の場合はmanifest既定コマンド名でprobeされ、利用可能と判定される', async () => {
    const probed: string[] = [];
    const map = entryMap(
      await checkWithProbe(async ({ toolName }) => {
        probed.push(toolName);
      }),
    );

    // drawio既定値の'drawio'・Chromeのplatform既定パスがprobeされる。
    assert.ok(probed.includes(TOOL_DRAWIO));
    assert.ok(probed.includes(TOOL_BROWSER));
    assert.strictEqual(map.get('drawio')?.available, true);
    assert.strictEqual(map.get('drawio')?.settingId, 'graphics-workbench.execPath.drawio');
  });

  test('execPathを空白文字列で明示すると3ツールすべてmissing（notConfigured）になり、probeしない', async () => {
    const probed: string[] = [];
    const map = entryMap(
      await checkWithProbe(
        async ({ toolName }) => {
          probed.push(toolName);
        },
        {
          'execPath.drawio': '   ',
          'execPath.rsvgConvert': '',
          'execPath.chrome': '  ',
          'convertToPdf.svg.engine': 'rsvg-convert',
        },
      ),
    );

    assert.deepStrictEqual(map.get('drawio'), {
      id: 'drawio',
      available: false,
      detail: userMessage('message.environmentCheck.notConfigured', TOOL_DRAWIO, 'graphics-workbench.execPath.drawio'),
      settingId: 'graphics-workbench.execPath.drawio',
    });
    assert.strictEqual(map.get('svg-to-pdf')?.available, false);
    assert.strictEqual(map.get('svg-to-pdf')?.settingId, 'graphics-workbench.execPath.rsvgConvert');
    assert.strictEqual(probed.length, 0);
  });

  test('timeoutと一般的な起動失敗を利用不可detailへ変換する', async () => {
    const timedOut = entryMap(
      await checkWithProbe(
        async ({ toolName }) => {
          if (toolName === TOOL_BROWSER) {
            throw new Error('Chrome timed out after 10000ms');
          }
        },
        { 'execPath.chrome': 'chrome-path' },
      ),
    );
    assert.strictEqual(
      timedOut.get('svg-to-pdf')?.detail,
      userMessage('message.environmentCheck.timedOut', TOOL_BROWSER),
    );

    const failed = entryMap(
      await checkWithProbe(
        async ({ toolName }) => {
          if (toolName === TOOL_DRAWIO) {
            throw new Error('exit 2');
          }
        },
        { 'execPath.drawio': 'drawio-path' },
      ),
    );
    assert.strictEqual(
      failed.get('drawio')?.detail,
      userMessage('message.environmentCheck.failed', TOOL_DRAWIO, 'exit 2'),
    );
  });
});

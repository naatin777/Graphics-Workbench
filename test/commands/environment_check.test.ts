// Test target:
// - 外部ツールごとの利用可否が機能単位で判定されること
// - 利用可能 / 未導入(ENOENT) / パス設定無効 / タイムアウト / 非ゼロ終了 を区別すること
// - 複数ツールのうち一部だけ利用可能な場合、それぞれ独立して判定されること
// - 組み込み機能（画像変換・PDF結合/分割/並び替え）は常に利用可能であること
// - Chrome実行パスを設定した場合にその値を確認すること
//
// Mocked:
// - なし。probe関数を注入して外部ツール実行を模擬する
//
// Not tested:
// - VS CodeのQuickPick表示と設定ページ遷移
// - 実際の外部ツールの実行

import assert from 'node:assert/strict';

import { userMessage } from '../../src/commands/shared/user_messages.js';
import {
  runEnvironmentChecks,
  type EnvironmentCheckEntry,
  type RunEnvironmentChecksOptions,
} from '../../src/commands/shared/environment_check.js';
import { fakeConfiguration } from '../helpers/configuration.js';

const FEATURE_IMAGE_CONVERSION = userMessage('message.environmentCheck.feature.imageConversion');
const FEATURE_PDF_MERGE = userMessage('message.environmentCheck.feature.pdfMergeSplitReorder');
const FEATURE_DRAWIO = userMessage('message.environmentCheck.feature.drawioConversion');
const FEATURE_MERMAID = userMessage('message.environmentCheck.feature.mermaidConversion');
const FEATURE_MERMAID_CLI = userMessage('message.environmentCheck.feature.mermaidCli');
const FEATURE_SVG_TO_PDF = userMessage('message.environmentCheck.feature.svgToPdf');

const TOOL_DRAWIO = userMessage('message.environmentCheck.tool.drawio');
const TOOL_RSVG = userMessage('message.environmentCheck.tool.rsvgConvert');
const TOOL_BROWSER = userMessage('message.environmentCheck.tool.browser');

function checkWithProbe(
  probe: (params: { toolName: string }) => Promise<void>,
  overrides: Record<string, unknown> = {},
): Promise<EnvironmentCheckEntry[]> {
  const options: RunEnvironmentChecksOptions = {
    configuration: fakeConfiguration(overrides),
    probe,
  };
  return runEnvironmentChecks(options);
}

function entryMap(entries: EnvironmentCheckEntry[]): Map<string, EnvironmentCheckEntry> {
  return new Map(entries.map((entry) => [entry.feature, entry]));
}

suite('環境チェック（機能単位の状態判定）', () => {
  test('組み込み機能は常に利用可能と判定される', async () => {
    const entries = await checkWithProbe(async () => {});

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_IMAGE_CONVERSION)?.status, 'available');
    assert.strictEqual(map.get(FEATURE_PDF_MERGE)?.status, 'available');
  });

  test('全ツールが利用可能な場合は全てavailableになる', async () => {
    const entries = await checkWithProbe(async () => {});

    assert.ok(entries.length >= 5, `expected at least 5 entries, got ${entries.length}`);
    assert.ok(entries.every((entry) => entry.status === 'available'));
  });

  test('未導入（ENOENT）のツールはunavailableになる', async () => {
    const entries = await checkWithProbe(async (params) => {
      if (params.toolName === userMessage('message.environmentCheck.tool.mermaidCli')) {
        const error = new Error('spawn mmdc ENOENT');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
    });

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_MERMAID_CLI)?.status, 'unavailable');
    assert.strictEqual(
      map.get(FEATURE_MERMAID_CLI)?.detail,
      userMessage('message.environmentCheck.notFound', userMessage('message.environmentCheck.tool.mermaidCli')),
    );
    assert.strictEqual(map.get(FEATURE_PDF_MERGE)?.status, 'available');
  });

  test('パス設定が無効（実行ファイル不在）のツールはunavailableになる', async () => {
    const entries = await checkWithProbe(async (params) => {
      if (params.toolName === TOOL_DRAWIO) {
        const error = new Error('spawn drawio ENOENT');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
    });

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_DRAWIO)?.status, 'unavailable');
    assert.strictEqual(map.get(FEATURE_DRAWIO)?.detail, userMessage('message.environmentCheck.notFound', TOOL_DRAWIO));
  });

  test('バージョン確認がタイムアウトしたツールはunavailableになる', async () => {
    const entries = await checkWithProbe(async (params) => {
      if (params.toolName === userMessage('message.environmentCheck.tool.mermaidCli')) {
        throw new Error('mmdc timed out after 10000ms');
      }
    });

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_MERMAID_CLI)?.status, 'unavailable');
    assert.strictEqual(
      map.get(FEATURE_MERMAID_CLI)?.detail,
      userMessage('message.environmentCheck.timedOut', userMessage('message.environmentCheck.tool.mermaidCli')),
    );
  });

  test('バージョン確認が非ゼロ終了したツールはunavailableになる', async () => {
    const entries = await checkWithProbe(async (params) => {
      if (params.toolName === TOOL_DRAWIO) {
        throw new Error('Draw.io failed (exited with code 1)');
      }
    });

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_DRAWIO)?.status, 'unavailable');
    assert.strictEqual(
      map.get(FEATURE_DRAWIO)?.detail,
      userMessage('message.environmentCheck.failed', TOOL_DRAWIO, 'Draw.io failed (exited with code 1)'),
    );
  });

  test('複数ツールのうち一部だけ利用可能な場合はそれぞれ独立に判定される', async () => {
    const entries = await checkWithProbe(async (params) => {
      if (params.toolName === userMessage('message.environmentCheck.tool.mermaidCli')) {
        const error = new Error('spawn ENOENT');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
    });

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_MERMAID_CLI)?.status, 'unavailable');
    assert.strictEqual(map.get(FEATURE_DRAWIO)?.status, 'available');
    assert.strictEqual(map.get(FEATURE_MERMAID)?.status, 'available');
  });

  test('設定済みのブラウザ実行パスを使う場合はプローブ対象になる', async () => {
    const probed: string[] = [];
    const entries = await checkWithProbe(
      async (params) => {
        probed.push(params.toolName);
      },
      { 'execPath.chrome': '/opt/custom-chrome' },
    );

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_MERMAID)?.status, 'available');
    assert.ok(probed.includes(TOOL_BROWSER));
  });

  test('rsvg-convertエンジン指定時のみSVG変換チェックを追加する', async () => {
    const chromeProbed: string[] = [];
    const chromeEntries = await checkWithProbe(async (params) => {
      chromeProbed.push(params.toolName);
    });

    assert.ok(!entryMap(chromeEntries).has(FEATURE_SVG_TO_PDF));
    assert.ok(!chromeProbed.includes(TOOL_RSVG));

    const rsvgProbed: string[] = [];
    const rsvgEntries = await checkWithProbe(
      async (params) => {
        rsvgProbed.push(params.toolName);
      },
      { 'convertToPdf.svg.engine': 'rsvg-convert' },
    );

    assert.strictEqual(entryMap(rsvgEntries).get(FEATURE_SVG_TO_PDF)?.status, 'available');
    assert.ok(rsvgProbed.includes(TOOL_RSVG));
  });

  test('詳細にはローカルの絶対パスを含めない', async () => {
    const entries = await checkWithProbe(async (params) => {
      if (params.toolName === userMessage('message.environmentCheck.tool.mermaidCli')) {
        const error = new Error('spawn /Users/me/secret/mmdc ENOENT');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
    });

    const detail = entryMap(entries).get(FEATURE_MERMAID_CLI)?.detail ?? '';
    assert.ok(!detail.includes('/Users/me/secret'));
    assert.strictEqual(
      detail,
      userMessage('message.environmentCheck.notFound', userMessage('message.environmentCheck.tool.mermaidCli')),
    );
  });

  test('statusとdetailは常に揃っている', async () => {
    const entries = await checkWithProbe(async () => {
      throw new Error('boom');
    });

    for (const entry of entries) {
      assert.ok(entry.feature.length > 0);
      assert.ok(entry.detail.length > 0);
      assert.ok(entry.status === 'available' || entry.status === 'unavailable');
      if (entry.status === 'unavailable') {
        assert.ok(entry.settingId !== undefined);
      }
    }
  });
});

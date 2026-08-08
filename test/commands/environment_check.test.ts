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
  runFeatureAvailabilityChecks,
  type EnvironmentCheckEntry,
  type FeatureAvailabilityEntry,
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

suite('外部ツールの起動結果ごとに機能単位で利用可否を判定する環境チェック', () => {
  test('外部ツールの起動結果に関わらず、組み込み機能の画像変換とPDF結合/分割/並び替えは常に利用可能と判定する', async () => {
    const entries = await checkWithProbe(async () => {});

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_IMAGE_CONVERSION)?.status, 'available');
    assert.strictEqual(map.get(FEATURE_PDF_MERGE)?.status, 'available');
  });

  test('全ての外部ツールが正常に起動できる場合は、チェック対象の全機能を利用可能と報告する', async () => {
    const entries = await checkWithProbe(async () => {});

    assert.ok(entries.length >= 5, `expected at least 5 entries, got ${entries.length}`);
    assert.ok(entries.every((entry) => entry.status === 'available'));
  });

  test('Mermaid CLIの起動でENOENTエラーが発生した場合は、そのツールを未導入として利用不可と判定し、未導入の詳細メッセージを設定する（PDF結合機能は利用可能のまま）', async () => {
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

  test('Draw.ioの実行ファイルパスを設定しているが起動時にENOENTが発生する場合は、パス設定が無効として利用不可と判定し、未導入の詳細メッセージを設定する', async () => {
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

  test('Mermaid CLIのバージョン確認がタイムアウトした場合は利用不可と判定し、タイムアウトを示す詳細を設定する', async () => {
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

  test('Draw.ioのバージョン確認が非ゼロ終了コードで終了した場合は利用不可と判定し、失敗メッセージを詳細に設定する', async () => {
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

  test('複数ツールのうちMermaid CLIだけがENOENTで起動できない場合でも、その他のDraw.ioとMermaidの機能は独立に利用可能と判定する', async () => {
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

  test('Chrome実行パスを設定済みの場合はその設定パスでブラウザをプローブし、Mermaid機能が利用可能と判定される', async () => {
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

  test('SVG→PDF変換チェックは設定された変換エンジンの実行ファイルのみをプローブし、既定ではexecPath.chrome、rsvg-convert設定時はexecPath.rsvgConvertの設定IDを持つ', async () => {
    const chromeProbed: string[] = [];
    const chromeEntries = await checkWithProbe(async (params) => {
      chromeProbed.push(params.toolName);
    });

    assert.strictEqual(entryMap(chromeEntries).get(FEATURE_SVG_TO_PDF)?.status, 'available');
    assert.strictEqual(
      entryMap(chromeEntries).get(FEATURE_SVG_TO_PDF)?.settingId,
      'graphics-workbench.execPath.chrome',
    );
    assert.ok(chromeProbed.includes(TOOL_BROWSER));
    assert.ok(!chromeProbed.includes(TOOL_RSVG));

    const rsvgProbed: string[] = [];
    const rsvgEntries = await checkWithProbe(
      async (params) => {
        rsvgProbed.push(params.toolName);
      },
      { 'convertToPdf.svg.engine': 'rsvg-convert' },
    );

    assert.strictEqual(entryMap(rsvgEntries).get(FEATURE_SVG_TO_PDF)?.status, 'available');
    assert.strictEqual(
      entryMap(rsvgEntries).get(FEATURE_SVG_TO_PDF)?.settingId,
      'graphics-workbench.execPath.rsvgConvert',
    );
    assert.ok(rsvgProbed.includes(TOOL_RSVG));
  });

  test('Mermaid CLIの起動失敗で絶対パスを含むENOENTが発生しても、詳細表示にはローカルマシンの絶対パスを含めず未導入の詳細メッセージを返す', async () => {
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

  test('全外部ツールで起動エラーが発生する場合でも、各機能エントリはfeatureとdetailを持ち、利用不可のときは設定IDを必ず持つ', async () => {
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

suite('ユーザー視点の機能単位で利用可否を返すrunFeatureAvailabilityChecks', () => {
  function featureCheckWithProbe(
    probe: (params: { toolName: string }) => Promise<void>,
    overrides: Record<string, unknown> = {},
  ): Promise<FeatureAvailabilityEntry[]> {
    return runFeatureAvailabilityChecks({
      configuration: fakeConfiguration(overrides),
      probe,
    });
  }

  function featureEntryMap(entries: FeatureAvailabilityEntry[]): Map<string, FeatureAvailabilityEntry> {
    return new Map(entries.map((entry) => [entry.id, entry]));
  }

  test('PDF operationsとImagesは外部ツールに依存せず常に利用可能と判定する', async () => {
    const map = featureEntryMap(await featureCheckWithProbe(async () => {}));

    assert.strictEqual(map.get('pdf-operations')?.available, true);
    assert.strictEqual(map.get('images')?.available, true);
  });

  test('SVG → PDFは選択した変換エンジンの利用可否に連動し、選択エンジンが無い場合は利用不可と判定する', async () => {
    const rsvgUnavailable = featureEntryMap(
      await featureCheckWithProbe(
        async (params) => {
          if (params.toolName === userMessage('message.environmentCheck.tool.rsvgConvert')) {
            const error = new Error('spawn rsvg-convert ENOENT');
            Object.assign(error, { code: 'ENOENT' });
            throw error;
          }
        },
        { 'convertToPdf.svg.engine': 'rsvg-convert' },
      ),
    );

    assert.strictEqual(rsvgUnavailable.get('svg-to-pdf')?.available, false);

    const chromeAvailable = featureEntryMap(
      await featureCheckWithProbe(async () => {}, { 'convertToPdf.svg.engine': 'chrome' }),
    );

    assert.strictEqual(chromeAvailable.get('svg-to-pdf')?.available, true);
  });

  test('Draw.ioはdrawioツールの利用可否をそのまま反映する', async () => {
    const entries = await featureCheckWithProbe(async (params) => {
      if (params.toolName === userMessage('message.environmentCheck.tool.drawio')) {
        const error = new Error('spawn drawio ENOENT');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
    });

    assert.strictEqual(featureEntryMap(entries).get('drawio')?.available, false);
  });

  test('Mermaidはmmdcとchromeの両方が利用可能な場合だけ利用可能と判定する', async () => {
    const mermaidCliOnly = featureEntryMap(
      await featureCheckWithProbe(async (params) => {
        if (params.toolName === userMessage('message.environmentCheck.tool.browser')) {
          const error = new Error('spawn chrome ENOENT');
          Object.assign(error, { code: 'ENOENT' });
          throw error;
        }
      }),
    );

    assert.strictEqual(mermaidCliOnly.get('mermaid')?.available, false);

    const bothAvailable = featureEntryMap(await featureCheckWithProbe(async () => {}));

    assert.strictEqual(bothAvailable.get('mermaid')?.available, true);
  });

  test('SVG → PDFは選択エンジンが利用できない場合でも別エンジンへフォールバックせず、利用不可のまま返す', async () => {
    const chromeBrokenButRsvgAvailable = featureEntryMap(
      await featureCheckWithProbe(
        async (params) => {
          if (params.toolName === userMessage('message.environmentCheck.tool.browser')) {
            const error = new Error('spawn chrome ENOENT');
            Object.assign(error, { code: 'ENOENT' });
            throw error;
          }
        },
        { 'convertToPdf.svg.engine': 'rsvg-convert' },
      ),
    );

    assert.strictEqual(chromeBrokenButRsvgAvailable.get('svg-to-pdf')?.available, true);

    const rsvgUnavailable = featureEntryMap(
      await featureCheckWithProbe(
        async (params) => {
          if (params.toolName === userMessage('message.environmentCheck.tool.rsvgConvert')) {
            const error = new Error('spawn rsvg-convert ENOENT');
            Object.assign(error, { code: 'ENOENT' });
            throw error;
          }
        },
        { 'convertToPdf.svg.engine': 'rsvg-convert' },
      ),
    );

    assert.strictEqual(rsvgUnavailable.get('svg-to-pdf')?.available, false);
    assert.strictEqual(rsvgUnavailable.get('mermaid')?.available, true);
  });
});

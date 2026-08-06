// Test target:
// - 外部ツールごとの利用可否が機能単位で判定されること
// - 利用可能 / 未導入(ENOENT) / パス設定無効 / タイムアウト / 非ゼロ終了 を区別すること
// - 複数ツールのうち一部だけ利用可能な場合、それぞれ独立して判定されること
// - 組み込み機能（画像変換・PDF結合/分割/並び替え）は常に利用可能であること
// - Firefox指定時にブラウザ実行パス未設定なら不足と判定すること
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
const FEATURE_PDF_CROP = userMessage('message.environmentCheck.feature.pdfCrop');
const FEATURE_PDF_TO_IMAGE = userMessage('message.environmentCheck.feature.pdfToImage');
const FEATURE_DRAWIO = userMessage('message.environmentCheck.feature.drawioConversion');
const FEATURE_MERMAID = userMessage('message.environmentCheck.feature.mermaidConversion');
const FEATURE_ENCRYPT = userMessage('message.environmentCheck.feature.pdfEncryptDecrypt');
const FEATURE_SVG_TO_PDF = userMessage('message.environmentCheck.feature.svgToPdf');

const TOOL_GHOSTSCRIPT = userMessage('message.environmentCheck.tool.ghostscript');
const TOOL_PDFTOCAIRO = userMessage('message.environmentCheck.tool.pdftocairo');
const TOOL_DRAWIO = userMessage('message.environmentCheck.tool.drawio');
const TOOL_QPDF = userMessage('message.environmentCheck.tool.qpdf');
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

    assert.ok(entries.length >= 7, `expected at least 7 entries, got ${entries.length}`);
    assert.ok(entries.every((entry) => entry.status === 'available'));
  });

  test('未導入（ENOENT）のツールはunavailableになる', async () => {
    const entries = await checkWithProbe(async (params) => {
      if (params.toolName === TOOL_GHOSTSCRIPT) {
        const error = new Error('spawn gs ENOENT');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
    });

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_PDF_CROP)?.status, 'unavailable');
    assert.strictEqual(
      map.get(FEATURE_PDF_CROP)?.detail,
      userMessage('message.environmentCheck.notFound', TOOL_GHOSTSCRIPT),
    );
    assert.strictEqual(map.get(FEATURE_PDF_MERGE)?.status, 'available');
  });

  test('パス設定が無効（実行ファイル不在）のツールはunavailableになる', async () => {
    const entries = await checkWithProbe(async (params) => {
      if (params.toolName === TOOL_QPDF) {
        const error = new Error('spawn qpdf ENOENT');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
    });

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_ENCRYPT)?.status, 'unavailable');
    assert.strictEqual(map.get(FEATURE_ENCRYPT)?.detail, userMessage('message.environmentCheck.notFound', TOOL_QPDF));
  });

  test('バージョン確認がタイムアウトしたツールはunavailableになる', async () => {
    const entries = await checkWithProbe(async (params) => {
      if (params.toolName === TOOL_PDFTOCAIRO) {
        throw new Error('pdftocairo timed out after 10000ms');
      }
    });

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_PDF_TO_IMAGE)?.status, 'unavailable');
    assert.strictEqual(
      map.get(FEATURE_PDF_TO_IMAGE)?.detail,
      userMessage('message.environmentCheck.timedOut', TOOL_PDFTOCAIRO),
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
      if (params.toolName === TOOL_GHOSTSCRIPT || params.toolName === TOOL_QPDF) {
        const error = new Error('spawn ENOENT');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
    });

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_PDF_CROP)?.status, 'unavailable');
    assert.strictEqual(map.get(FEATURE_ENCRYPT)?.status, 'unavailable');
    assert.strictEqual(map.get(FEATURE_PDF_TO_IMAGE)?.status, 'available');
    assert.strictEqual(map.get(FEATURE_MERMAID)?.status, 'available');
  });

  test('Firefox指定時にブラウザ実行パスが未設定なら不足と判定される', async () => {
    const entries = await checkWithProbe(async () => {}, {
      'puppeteer.browser': 'firefox',
      'puppeteer.executablePath': '',
    });

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_MERMAID)?.status, 'unavailable');
    assert.strictEqual(
      map.get(FEATURE_MERMAID)?.detail,
      userMessage('message.environmentCheck.browserFirefoxNeedsPath'),
    );
  });

  test('設定済みのブラウザ実行パスを使う場合はプローブ対象になる', async () => {
    const probed: string[] = [];
    const entries = await checkWithProbe(
      async (params) => {
        probed.push(params.toolName);
      },
      { 'puppeteer.executablePath': '/opt/custom-chrome' },
    );

    const map = entryMap(entries);
    assert.strictEqual(map.get(FEATURE_MERMAID)?.status, 'available');
    assert.ok(probed.includes(TOOL_BROWSER));
  });

  test('rsvg-convertエンジン指定時のみSVG変換チェックを追加する', async () => {
    const puppeteerProbed: string[] = [];
    const puppeteerEntries = await checkWithProbe(async (params) => {
      puppeteerProbed.push(params.toolName);
    });

    assert.ok(!entryMap(puppeteerEntries).has(FEATURE_SVG_TO_PDF));
    assert.ok(!puppeteerProbed.includes(TOOL_RSVG));

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
      if (params.toolName === TOOL_GHOSTSCRIPT) {
        const error = new Error('spawn /Users/me/secret/gs ENOENT');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
    });

    const detail = entryMap(entries).get(FEATURE_PDF_CROP)?.detail ?? '';
    assert.ok(!detail.includes('/Users/me/secret'));
    assert.strictEqual(detail, userMessage('message.environmentCheck.notFound', TOOL_GHOSTSCRIPT));
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

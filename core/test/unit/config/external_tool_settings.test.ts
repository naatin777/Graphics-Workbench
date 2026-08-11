import assert from 'node:assert/strict';

import {
  type ExternalToolTimeoutConfiguration,
  readExternalToolTimeouts,
  timeoutMilliseconds,
} from '@graphics-workbench/core/config/external_tools/external_tool_settings.js';

function timeoutConfiguration(values: Partial<Record<'drawio' | 'mermaid' | 'rsvgConvert', number>>) {
  return {
    externalTools: {
      drawio: { timeoutSeconds: () => values.drawio ?? 0 },
      mermaid: { timeoutSeconds: () => values.mermaid ?? 0 },
      rsvgConvert: { timeoutSeconds: () => values.rsvgConvert ?? 0 },
    },
  } satisfies ExternalToolTimeoutConfiguration;
}

suite('外部ツールタイムアウト設定', () => {
  test('設定未指定の既定タイムアウトはdrawio/mermaidともundefinedで、timeoutMillisecondsは0をundefinedのままにし86400秒を86,400,000ミリ秒へ変換する', () => {
    const timeouts = readExternalToolTimeouts(timeoutConfiguration({}));

    assert.strictEqual(timeouts.drawio, undefined);
    assert.strictEqual(timeouts.mermaid, undefined);
    assert.strictEqual(timeoutMilliseconds(0), undefined);
    assert.strictEqual(timeoutMilliseconds(86_400), 86_400_000);
  });

  test('rsvgConvertのtimeoutSecondsが0なら無期限(undefined)として読み取り、mermaidのtimeoutSeconds=5は5,000ミリ秒に変換する', () => {
    const timeouts = readExternalToolTimeouts(timeoutConfiguration({ rsvgConvert: 0, mermaid: 5 }));

    assert.strictEqual(timeouts.rsvgConvert, undefined);
    assert.strictEqual(timeouts.mermaid, 5_000);
  });
});

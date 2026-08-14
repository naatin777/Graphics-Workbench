import assert from 'node:assert/strict';

import {
  type ExternalToolTimeoutConfiguration,
  readExternalToolTimeouts,
  timeoutMilliseconds,
} from '@graphics-workbench/core/external-tools';

function timeoutConfiguration(values: Partial<Record<'drawio' | 'rsvgConvert', number>>) {
  return {
    externalTools: {
      drawio: { timeoutSeconds: () => values.drawio ?? 0 },
      rsvgConvert: { timeoutSeconds: () => values.rsvgConvert ?? 0 },
    },
  } satisfies ExternalToolTimeoutConfiguration;
}

describe('外部ツールタイムアウト設定', () => {
  it('設定未指定の既定タイムアウトはdrawioがundefinedで、timeoutMillisecondsは0をundefinedのままにし86400秒を86,400,000ミリ秒へ変換する', () => {
    const timeouts = readExternalToolTimeouts(timeoutConfiguration({}));

    assert.strictEqual(timeouts.drawio, undefined);
    assert.strictEqual(timeoutMilliseconds(0), undefined);
    assert.strictEqual(timeoutMilliseconds(86_400), 86_400_000);
  });

  it('rsvgConvertのtimeoutSecondsが0なら無期限(undefined)として読み取る', () => {
    const timeouts = readExternalToolTimeouts(timeoutConfiguration({ rsvgConvert: 0 }));

    assert.strictEqual(timeouts.rsvgConvert, undefined);
  });
});

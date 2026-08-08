import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = new URL('./check-pr-body.mjs', import.meta.url).pathname;

function runScript(body) {
  const directory = mkdtempSync(join(tmpdir(), 'check-pr-body-'));
  const bodyPath = join(directory, 'body.txt');
  writeFileSync(bodyPath, body, 'utf8');
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, '--body', bodyPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stderr: '', stdout };
  } catch (error) {
    return { code: error.status ?? 1, stderr: error.stderr ?? '', stdout: error.stdout ?? '' };
  }
}

const completeBody = [
  '## Summary',
  '',
  '- Change A',
  '- Change B',
  '',
  '## Verification',
  '',
  '- npm run check:all passed',
  '',
  '## Risk / Review focus',
  '',
  '- None.',
  '',
  '## Privacy checklist',
  '',
  '- [ ] No local machine details are included in this PR body.',
].join('\n');

void test('必要なセクションが埋まっているPR bodyは成功する', () => {
  const result = runScript(completeBody);
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /filled/u);
});

void test('Summaryが空のPR bodyは失敗する', () => {
  const body = completeBody.replace('- Change A\n- Change B\n', '-\n');
  const result = runScript(body);
  assert.strictEqual(result.code, 1);
  assert.match(result.stderr, /missing required content for: Summary/u);
});

void test('Verificationが空のPR bodyは失敗する', () => {
  const body = completeBody.replace('- npm run check:all passed\n', '');
  const result = runScript(body);
  assert.strictEqual(result.code, 1);
  assert.match(result.stderr, /missing required content for: Verification/u);
});

void test('SummaryがHTMLコメントだけのPR bodyは失敗する', () => {
  const body = completeBody.replace('- Change A\n- Change B\n', '<!-- placeholder -->\n');
  const result = runScript(body);
  assert.strictEqual(result.code, 1);
  assert.match(result.stderr, /Summary/u);
});

void test('--bodyを渡さないとusageエラーになる', () => {
  const result = (() => {
    try {
      execFileSync(process.execPath, [scriptPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stderr: '' };
    } catch (error) {
      return { code: error.status ?? 1, stderr: error.stderr ?? '' };
    }
  })();
  assert.strictEqual(result.code, 2);
  assert.match(result.stderr, /Usage:/u);
});

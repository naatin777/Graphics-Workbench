import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = new URL('./check-prs-landed.mjs', import.meta.url).pathname;

function hasGh() {
  try {
    execFileSync('which', ['gh'], { encoding: 'utf8', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function prStateOrSkip(t) {
  try {
    return execFileSync('gh', ['pr', 'view', '172', '--json', 'state', '--jq', '.state'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    t.skip('gh CLI is not authenticated in this environment');
    return undefined;
  }
}

const ghAvailable = hasGh();

function runScript(args) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (error) {
    return {
      code: error.status,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

void test('usageエラーはexit code 2で、ヒントを出力する', () => {
  const result = runScript(['--no-fetch']);
  assert.strictEqual(result.code, 2);
  assert.match(result.stderr, /Usage:/u);
});

void test('unknown optionはエラーになる', () => {
  const result = runScript(['--bogus', '--no-fetch']);
  assert.strictEqual(result.code, 1);
  assert.match(result.stderr, /Unknown option/u);
});

void test('mainにマージ済みのPRはlandedと判定する', (t) => {
  if (!ghAvailable) {
    t.skip('gh CLI is not available in this environment');
    return;
  }
  // #172 and #173 are merged into origin/main (squash merged), so their merge
  // commits must be ancestors of origin/main.
  const mergedPr = prStateOrSkip(t);
  if (mergedPr === undefined) {
    return;
  }
  assert.strictEqual(mergedPr, 'MERGED');

  const result = runScript(['172', '173', '--no-fetch']);
  assert.strictEqual(result.code, 0);
  assert.match(result.stdout, /landed/u);
});

void test('存在しないPR番号は失敗する', (t) => {
  if (!ghAvailable) {
    t.skip('gh CLI is not available in this environment');
    return;
  }
  if (prStateOrSkip(t) === undefined) {
    return;
  }
  const result = runScript(['999999999', '--no-fetch']);
  assert.strictEqual(result.code, 1);
});

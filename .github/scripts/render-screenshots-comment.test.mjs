import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderFailureSection, renderSnapshotSection } from './render-screenshots-comment.mjs';

const repository = 'naatin777/Graphics-Workbench';

/**
 * @param {string} spec
 * @param {string} theme
 * @param {string} platform
 * @returns {{ kind: 'snapshot'; spec: string; theme: string; platform: string; name: string }}
 */
function snapshotFile(spec, theme, platform) {
  return {
    kind: 'snapshot',
    spec,
    theme,
    platform,
    name: `${spec}-pdf-configure-${theme}-vscode-electron-${platform}.png`,
  };
}

const fullThemeFiles = ['dark', 'light', 'default-high-contrast', 'red', 'abyss'].flatMap((theme) =>
  ['darwin', 'linux', 'win32'].map((platform) => snapshotFile('crop', theme, platform)),
);

void test('スナップショットテーブルのヘッダーは Theme/macOS/Linux/Windows の4セル', () => {
  const rows = renderSnapshotSection(fullThemeFiles, repository);
  assert.strictEqual(rows[0], '| Theme | macOS | Linux | Windows |');
  assert.strictEqual(rows[0].split('|').filter((cell) => cell.trim() !== '').length, 4);
});
void test('スナップショットテーブルの区切り行は正確に |---|---|---|---|---| の4セル', () => {
  const rows = renderSnapshotSection(fullThemeFiles, repository);
  const delimiter = rows[1];
  assert.strictEqual(delimiter, '|---|---|---|---|');
  assert.strictEqual(delimiter.split('|').filter((cell) => cell.trim() !== '').length, 4);
});

void test('区切り行はASCIIのハイフンのみで、Unicodeダッシュや全角空白が混入しない', () => {
  const rows = renderSnapshotSection(fullThemeFiles, repository);
  const delimiter = rows[1];
  assert.ok(delimiter);
  assert.ok(!/[—–　\u3000]/.test(delimiter), `区切り行にUnicode空白/ダッシュが含まれる: ${delimiter}`);
  assert.match(delimiter, /^(?:\|-{3}){3}\|-{3}\|$/u);
});

void test('各テーマ行は Theme/macOS/Linux/Windows の4セル', () => {
  const rows = renderSnapshotSection(fullThemeFiles, repository);
  const themeRows = rows.slice(2);
  assert.strictEqual(themeRows.length, 5);
  for (const row of themeRows) {
    assert.ok(row);
    const cells = row.split('|').filter((cell) => cell.trim() !== '');
    assert.strictEqual(cells.length, 4, `テーマ行のセル数が4ではない: ${row}`);
  }
});

void test('各テーマ行はテーマ名で始まり、3OSの画像リンクを持つ', () => {
  const rows = renderSnapshotSection(fullThemeFiles, repository);
  const darkRow = rows.find((row) => row.startsWith('| Dark |'));
  if (darkRow === undefined) {
    assert.fail('Dark のテーマ行が存在しない');
  }
  assert.match(darkRow, /<a href=.*darwin.*>.*<img.*<\/a>/u);
  assert.match(darkRow, /<a href=.*linux.*>.*<img.*<\/a>/u);
  assert.match(darkRow, /<a href=.*win32.*>.*<img.*<\/a>/u);
});

void test('ファイル欠損時は ASCII の - をセルに入れ、セル数は維持する', () => {
  const files = [snapshotFile('crop', 'dark', 'darwin'), snapshotFile('crop', 'dark', 'linux')];
  const rows = renderSnapshotSection(files, repository);
  const darkRow = rows.find((row) => row.startsWith('| Dark |'));
  if (darkRow === undefined) {
    assert.fail('Dark のテーマ行が存在しない');
  }
  assert.strictEqual(darkRow.split('|').filter((cell) => cell.trim() !== '').length, 4);
  assert.match(darkRow, /\| - \|$/u);
  assert.ok(!darkRow.includes('—'), '欠損セルにemダッシュが混入している');
});

void test('failureテーブルは列定義から3セルで正しく生成される', () => {
  const failures = [
    {
      kind: 'failure',
      spec: 'crop',
      theme: 'dark',
      platform: 'darwin',
      kindName: 'actual',
      name: 'crop-actual.png',
    },
    {
      kind: 'failure',
      spec: 'crop',
      theme: 'dark',
      platform: 'darwin',
      kindName: 'diff',
      name: 'crop-diff.png',
    },
  ];
  const rows = renderFailureSection(failures, repository);
  assert.strictEqual(rows[0], '| Theme | Actual | Diff |');
  assert.strictEqual(rows[1], '|---|---|---|');
  const dataRow = rows[2];
  assert.ok(dataRow);
  assert.strictEqual(dataRow.split('|').filter((cell) => cell.trim() !== '').length, 3);
});

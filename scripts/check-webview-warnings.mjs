import { spawnSync } from 'node:child_process';

// Vite/Lightning CSS emits this warning for `:global(...)` used as a plain CSS
// pseudo-class. Rotate/Reorder previously shipped it; fail CI if it recurs.
const knownCssWarning = /not recognized as a valid pseudo-class/u;

const apps = ['crop_pdf', 'merge_pdf', 'split_pdf', 'rotate_pdf', 'reorder_pdf'];

let failed = false;

for (const app of apps) {
  const result = spawnSync('npx', ['vite', 'build', '--config', `webview/apps/${app}/vite.config.ts`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(`[check-webview-warnings] ${app} build failed.\n${result.stdout}${result.stderr}`);
    process.exit(result.status ?? 1);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const matches = output.split('\n').filter((line) => knownCssWarning.test(line));
  if (matches.length > 0) {
    failed = true;
    process.stderr.write(`[check-webview-warnings] ${app} emitted a known CSS warning:\n`);
    for (const match of matches) {
      process.stderr.write(`  ${match}\n`);
    }
  }
}

if (failed) {
  process.exit(1);
}

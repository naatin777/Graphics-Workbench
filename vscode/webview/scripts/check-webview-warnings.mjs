import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['exec', '--', 'vite', 'build'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  shell: false,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
if (/\b(?:warning|warn)\b/iu.test(output)) {
  process.stderr.write(output);
  throw new Error('Unified Webview build emitted a warning.');
}

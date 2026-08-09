import path from 'node:path';
import type { Plugin } from '@opencode-ai/plugin';

const FORMAT_AFTER_TOOLS = new Set(['edit', 'write']);
const FORMATTABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.jsonc', '.md', '.html', '.css']);
const DEBOUNCE_MS = 500;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const getFilePath = (args: unknown): string | undefined => {
  if (!isRecord(args)) {
    return undefined;
  }
  const { filePath } = args;
  if (typeof filePath !== 'string') {
    return undefined;
  }
  return filePath;
};

export default (async ({ directory, $ }) => {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    if (pending.size === 0) {
      return;
    }
    const files = [...pending];
    pending.clear();
    try {
      await $`${directory}/node_modules/.bin/oxfmt --config ${directory}/oxfmt.config.ts --write ${files}`.quiet();
    } catch {
      // 整形失敗は編集自体を妨げない。通常の検証(lint / format check)で検出される。
    }
  };

  return {
    'tool.execute.after': async ({ tool, args }) => {
      if (!FORMAT_AFTER_TOOLS.has(tool)) {
        return;
      }
      const rawFilePath = getFilePath(args);
      if (rawFilePath === undefined) {
        return;
      }
      if (!FORMATTABLE_EXTENSIONS.has(path.extname(rawFilePath))) {
        return;
      }
      pending.add(rawFilePath);
      clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    },
  };
}) satisfies Plugin;

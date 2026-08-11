import type { LineOutputChannel } from '@graphics-workbench/core/operations/external_tools/external_tool_ascii_scratch.js';

export class RecordingOutputChannel implements LineOutputChannel {
  readonly lines: string[] = [];

  appendLine(value: string): void {
    this.lines.push(value);
  }

  hasLine(pattern: string | RegExp): boolean {
    return this.lines.some((line) => (typeof pattern === 'string' ? line.includes(pattern) : pattern.test(line)));
  }
}

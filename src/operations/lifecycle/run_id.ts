import { randomUUID } from 'node:crypto';
import path from 'node:path';

const INTERNAL_PATH_SEGMENT_LIMIT = 128;

export type RunId = string & { readonly __brand: 'RunId' };

export function createRunId(): RunId {
  return asRunId(`${Date.now()}-${randomUUID()}`);
}

export function asRunId(value: string): RunId {
  assertSafePathSegment(value, 'runId');
  return value;
}

export function assertSafePathSegment(value: string, label = 'path segment'): asserts value is RunId {
  if (!isSafePathSegment(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
}

export function isSafePathSegment(value: string): value is RunId {
  if (
    value.length === 0 ||
    value.length > INTERNAL_PATH_SEGMENT_LIMIT ||
    value === '.' ||
    value === '..' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(value) ||
    /[ .]$/u.test(value) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(value)
  ) {
    return false;
  }

  return !value.includes('/') && !value.includes('\\');
}

export function createStagingRoot(workspacePath: string, operation: string, runId: string): string {
  assertSafePathSegment(operation, 'staging operation');
  assertSafePathSegment(runId, 'runId');
  return path.join(workspacePath, '.graphics-workbench', operation, runId);
}

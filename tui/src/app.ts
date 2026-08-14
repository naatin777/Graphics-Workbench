import path from 'node:path';

import {
  isAbortError,
  toErrorMessage,
  type ConversionExecutionContext,
  type OutputConflictDecision,
} from '@graphics-workbench/core/runtime';

import type { TerminalKey, TerminalScreen } from './screen.js';
import { terminalUiDefaults } from './defaults.js';
import {
  availableTerminalUiRasterTargets,
  inspectTerminalUiSource,
  resolveTerminalUiPages,
  runTerminalPdfRasterConversion,
  type TerminalUiPageSelection,
  type TerminalUiPdfRasterPlan,
  type TerminalUiPdfSource,
  type TerminalUiConversionResult,
  type TerminalUiRasterTarget,
} from './conversion_adapter.js';

type PageMode = 'all' | 'range';
type ConflictAction = 'cancel' | 'replace' | 'rename';
type AppState =
  | { kind: 'loading'; sourcePath: string }
  | { kind: 'format'; source: TerminalUiPdfSource; selectedIndex: number }
  | { kind: 'pages'; source: TerminalUiPdfSource; target: TerminalUiRasterTarget; selectedIndex: number }
  | { kind: 'range'; source: TerminalUiPdfSource; target: TerminalUiRasterTarget; value: string; error?: string }
  | { kind: 'review'; plan: TerminalUiPdfRasterPlan }
  | { kind: 'converting'; plan: TerminalUiPdfRasterPlan; completed: number; total: number; message: string }
  | {
      kind: 'conflict';
      plan: TerminalUiPdfRasterPlan;
      conflicts: string[];
      selectedIndex: number;
      resolve: (decision: OutputConflictDecision) => void;
    }
  | { kind: 'result'; status: 'success' | 'cancelled' | 'error'; title: string; details: string[] };

interface AppDependencies {
  inspectSource: typeof inspectTerminalUiSource;
  runConversion: typeof runTerminalPdfRasterConversion;
}

const defaultDependencies: AppDependencies = {
  inspectSource: inspectTerminalUiSource,
  runConversion: runTerminalPdfRasterConversion,
};

export async function runTerminalUi(
  sourceArgument: string,
  screen: TerminalScreen,
  dependencyOverrides: Partial<AppDependencies> = {},
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const sourcePath = path.resolve(sourceArgument);
  const abortController = new AbortController();
  let state: AppState = { kind: 'loading', sourcePath };
  let conversion: Promise<void> | undefined;
  let screenAlive = true;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const render = (): void => {
    if (!screenAlive) {
      return;
    }
    screen.setContent(renderState(state));
  };

  const cancelConversion = (): void => {
    abortController.abort();
    if (state.kind === 'conflict') {
      state.resolve('cancel');
    }
    if (state.kind === 'converting' || state.kind === 'conflict') {
      const { plan } = state;
      state = {
        kind: 'converting',
        plan,
        completed: 0,
        total: plan.inputCount,
        message: 'Cancellation requested; waiting for active work to stop…',
      };
      render();
    }
  };

  const exitOrCancel = (): void => {
    if (conversion === undefined) {
      abortController.abort();
      finish();
      return;
    }
    cancelConversion();
  };

  const handleSignal = (): void => {
    exitOrCancel();
  };

  const startConversion = (plan: TerminalUiPdfRasterPlan): void => {
    if (conversion !== undefined) {
      return;
    }

    state = {
      kind: 'converting',
      plan,
      completed: 0,
      total: plan.inputCount,
      message: `Converting PDF → ${targetLabel(plan.target)}`,
    };
    render();

    const runtime: ConversionExecutionContext = {
      signal: abortController.signal,
      outputChannel: {
        appendLine: (line) => {
          if (state.kind === 'converting') {
            state = { ...state, message: line };
            render();
          }
        },
      },
      reportMessage: (message) => {
        if (state.kind === 'converting') {
          state = { ...state, message };
          render();
        }
      },
      reportProgress: (completed, total) => {
        if (state.kind === 'converting') {
          state = { ...state, completed, total };
          render();
        }
      },
      resolveConflicts: async (conflicts) =>
        await new Promise<OutputConflictDecision>((resolve) => {
          if (abortController.signal.aborted) {
            resolve('cancel');
            return;
          }
          state = { kind: 'conflict', plan, conflicts, selectedIndex: 0, resolve };
          render();
        }),
    };

    const run = async (): Promise<void> => {
      try {
        const result = await dependencies.runConversion({
          plan,
          runtime,
          maxInputPixels: terminalUiDefaults.maxInputPixels,
          webpEffort: terminalUiDefaults.webpEffort,
        });
        state = successState(result);
      } catch (error) {
        state = isAbortError(error)
          ? { kind: 'result', status: 'cancelled', title: 'Conversion cancelled', details: [] }
          : { kind: 'result', status: 'error', title: 'Conversion failed', details: [toErrorMessage(error)] };
      } finally {
        conversion = undefined;
        render();
      }
    };
    conversion = run();
  };

  const handleKey = (key: TerminalKey): void => {
    if (key.ctrl && key.name.toLowerCase() === 'c') {
      exitOrCancel();
      return;
    }

    switch (state.kind) {
      case 'loading': {
        if (key.name === 'escape') {
          exitOrCancel();
        }
        break;
      }
      case 'format': {
        if (key.name === 'escape') {
          finish();
        } else if (key.name === 'up' || key.name === 'down') {
          const targets = availableTerminalUiRasterTargets(state.source.sourcePath);
          state = {
            ...state,
            selectedIndex: moveSelection(state.selectedIndex, targets.length, key.name === 'up' ? -1 : 1),
          };
          render();
        } else if (isEnter(key)) {
          const target = availableTerminalUiRasterTargets(state.source.sourcePath)[state.selectedIndex];
          if (target !== undefined) {
            state = { kind: 'pages', source: state.source, target, selectedIndex: 0 };
            render();
          }
        }
        break;
      }
      case 'pages': {
        if (key.name === 'escape') {
          state = { kind: 'format', source: state.source, selectedIndex: pdfRasterTargetIndex(state.target) };
          render();
        } else if (key.name === 'up' || key.name === 'down') {
          state = { ...state, selectedIndex: moveSelection(state.selectedIndex, 2, key.name === 'up' ? -1 : 1) };
          render();
        } else if (isEnter(key)) {
          const mode: PageMode = state.selectedIndex === 0 ? 'all' : 'range';
          if (mode === 'range') {
            state = { kind: 'range', source: state.source, target: state.target, value: '' };
          } else {
            state = createReviewState(state.source, state.target, { kind: 'all' });
          }
          render();
        }
        break;
      }
      case 'range': {
        if (key.name === 'escape') {
          state = { kind: 'pages', source: state.source, target: state.target, selectedIndex: 1 };
          render();
        } else if (key.name === 'backspace') {
          state = {
            kind: 'range',
            source: state.source,
            target: state.target,
            value: state.value.slice(0, -1),
          };
          render();
        } else if (isEnter(key)) {
          const selection: TerminalUiPageSelection = { kind: 'range', value: state.value };
          const parsed = resolveTerminalUiPages(selection, state.source.pageCount);
          if (parsed.ok) {
            state = createReviewState(state.source, state.target, selection);
          } else {
            state = { ...state, error: parsed.error };
          }
          render();
        } else if (/^[\d,\s-]$/u.test(key.sequence)) {
          state = {
            kind: 'range',
            source: state.source,
            target: state.target,
            value: `${state.value}${key.sequence}`,
          };
          render();
        }
        break;
      }
      case 'review': {
        if (key.name === 'escape') {
          state = { kind: 'pages', source: state.plan.source, target: state.plan.target, selectedIndex: 0 };
          render();
        } else if (isEnter(key)) {
          startConversion(state.plan);
        }
        break;
      }
      case 'converting': {
        if (key.name === 'escape') {
          cancelConversion();
        }
        break;
      }
      case 'conflict': {
        if (key.name === 'escape') {
          const { resolve } = state;
          const { plan } = state;
          state = {
            kind: 'converting',
            plan,
            completed: 0,
            total: plan.inputCount,
            message: 'Cancelling because output conflicts were not accepted…',
          };
          render();
          resolve('cancel');
        } else if (key.name === 'up' || key.name === 'down') {
          state = { ...state, selectedIndex: moveSelection(state.selectedIndex, 3, key.name === 'up' ? -1 : 1) };
          render();
        } else if (isEnter(key)) {
          const action = conflictActions[state.selectedIndex];
          if (action !== undefined) {
            const { resolve } = state;
            const { plan } = state;
            state = {
              kind: 'converting',
              plan,
              completed: 0,
              total: plan.inputCount,
              message: 'Applying conflict decision…',
            };
            render();
            resolve(conflictDecision(action));
          }
        }
        break;
      }
      case 'result': {
        if (key.name === 'escape' || isEnter(key) || key.name.toLowerCase() === 'q') {
          finish();
        }
        break;
      }
    }
  };

  const removeKeyHandler = screen.onKey(handleKey);
  const removeDestroyHandler = screen.onDestroy(() => {
    screenAlive = false;
    cancelConversion();
    finish();
  });
  process.on('SIGINT', handleSignal);

  try {
    render();
    try {
      const source = await dependencies.inspectSource({ sourcePath, signal: abortController.signal });
      const targets = availableTerminalUiRasterTargets(source.sourcePath);
      if (targets.length === 0) {
        throw new Error(`No Terminal UI conversions are available for: ${source.sourcePath}`);
      }
      state = { kind: 'format', source, selectedIndex: 0 };
    } catch (error) {
      state = isAbortError(error)
        ? { kind: 'result', status: 'cancelled', title: 'Cancelled', details: [] }
        : { kind: 'result', status: 'error', title: 'Could not open source', details: [toErrorMessage(error)] };
    }
    render();
    await finished;
    await conversion;
  } finally {
    screenAlive = false;
    process.off('SIGINT', handleSignal);
    removeDestroyHandler();
    removeKeyHandler();
    screen.destroy();
  }
}

const conflictActions = ['cancel', 'replace', 'rename'] as const satisfies readonly ConflictAction[];

export function conflictDecision(action: ConflictAction): OutputConflictDecision {
  switch (action) {
    case 'cancel': {
      return 'cancel';
    }
    case 'replace': {
      return 'overwrite';
    }
    case 'rename': {
      return 'keep-both';
    }
  }
  throw new Error('Unsupported output conflict action.');
}

function createReviewState(
  source: TerminalUiPdfSource,
  target: TerminalUiRasterTarget,
  selection: TerminalUiPageSelection,
): AppState {
  const pages = resolveTerminalUiPages(selection, source.pageCount);
  if (!pages.ok) {
    return {
      kind: 'range',
      source,
      target,
      value: selection.kind === 'range' ? selection.value : '',
      error: pages.error,
    };
  }
  return {
    kind: 'review',
    plan: {
      target,
      source,
      outputTemplate: terminalUiDefaults.outputTemplate[target],
      pages: pages.pages,
      inputCount: pages.pages.length,
    },
  };
}

function successState(result: TerminalUiConversionResult): AppState {
  const details = result.outputs.map((output) => output.outputPath);
  if (result.cleanup.failures.length > 0) {
    details.push(`Warning: ${result.cleanup.failures.length} temporary artifact root(s) could not be cleaned up.`);
  }
  return { kind: 'result', status: 'success', title: 'Conversion complete', details };
}

function renderState(state: AppState): string {
  switch (state.kind) {
    case 'loading': {
      return lines('Source', `  ${state.sourcePath}`, '', 'Analyzing PDF…', '', 'Esc / Ctrl+C  Cancel');
    }
    case 'format': {
      const targets = availableTerminalUiRasterTargets(state.source.sourcePath);
      return lines(
        'Source',
        `  ${path.basename(state.source.sourcePath)} (${state.source.pageCount} pages)`,
        '',
        'Convert to',
        ...targets.map((target, index) => choice(targetLabel(target), index === state.selectedIndex)),
        '',
        '↑/↓ Select   Enter Continue   Esc Exit',
      );
    }
    case 'pages': {
      return lines(
        `Convert PDF → ${targetLabel(state.target)}`,
        '',
        'Pages',
        choice(`All pages (1-${state.source.pageCount})`, state.selectedIndex === 0),
        choice('Range', state.selectedIndex === 1),
        '',
        `Output  ${outputTemplateFor(state.target)}`,
        '',
        '↑/↓ Select   Enter Continue   Esc Back',
      );
    }
    case 'range': {
      return lines(
        `Convert PDF → ${targetLabel(state.target)}`,
        '',
        `Pages (1-${state.source.pageCount})`,
        `  ${state.value}█`,
        '  Example: 1-3,5,8',
        ...(state.error === undefined ? [] : ['', `Error: ${state.error}`]),
        '',
        'Enter Continue   Esc Back',
      );
    }
    case 'review': {
      const outputLines = state.plan.pages.slice(0, 5).map((page) => `  Page ${page}`);
      if (state.plan.pages.length > 5) {
        outputLines.push(`  …and ${state.plan.pages.length - 5} more`);
      }
      return lines(
        `Convert PDF → ${targetLabel(state.plan.target)}`,
        '',
        `Source  ${state.plan.source.sourcePath}`,
        `Pages   ${state.plan.pages.join(', ')}`,
        '',
        'Output',
        ...outputLines,
        '',
        '[ Enter ] Convert   Esc Back',
      );
    }
    case 'converting': {
      return lines(
        `Converting PDF → ${targetLabel(state.plan.target)}`,
        '',
        progressBar(state.completed, state.total),
        `${state.completed} / ${state.total}`,
        '',
        state.message,
        '',
        'Esc / Ctrl+C  Cancel',
      );
    }
    case 'conflict': {
      return lines(
        'Output already exists',
        '',
        ...state.conflicts.slice(0, 4).map((conflict) => `  ${conflict}`),
        ...(state.conflicts.length > 4 ? [`  …and ${state.conflicts.length - 4} more`] : []),
        '',
        ...conflictActions.map((action, index) => choice(conflictActionLabel(action), index === state.selectedIndex)),
        '',
        '↑/↓ Select   Enter Confirm   Esc Cancel',
      );
    }
    case 'result': {
      return lines(
        state.title,
        '',
        ...state.details.map((detail) => `  ${detail}`),
        '',
        state.status === 'success' ? 'Enter / q  Exit' : 'Enter / Esc / q  Exit',
      );
    }
  }
  throw new Error('Unsupported Terminal UI state.');
}

function outputTemplateFor(target: TerminalUiRasterTarget): string {
  return terminalUiDefaults.outputTemplate[target];
}

function targetLabel(target: TerminalUiRasterTarget): string {
  return target === 'jpeg' ? 'JPEG' : target === 'webp' ? 'WebP' : 'PNG';
}

function conflictActionLabel(action: ConflictAction): string {
  switch (action) {
    case 'cancel': {
      return 'Cancel';
    }
    case 'replace': {
      return 'Replace';
    }
    case 'rename': {
      return 'Rename (keep both)';
    }
  }
  throw new Error('Unsupported output conflict action.');
}

function pdfRasterTargetIndex(target: TerminalUiRasterTarget): number {
  return Math.max(0, pdfRasterTargetsIndex(target));
}

function pdfRasterTargetsIndex(target: TerminalUiRasterTarget): number {
  return availableTerminalUiRasterTargets('source.pdf').indexOf(target);
}

function moveSelection(index: number, count: number, delta: number): number {
  return (index + delta + count) % count;
}

function isEnter(key: TerminalKey): boolean {
  return key.name === 'return' || key.name === 'enter' || key.name === 'kpenter';
}

function choice(label: string, selected: boolean): string {
  return `${selected ? '>' : ' '} ${label}`;
}

function progressBar(completed: number, total: number): string {
  const width = 24;
  const filled = total > 0 ? Math.min(width, Math.round((completed / total) * width)) : 0;
  return `[${'█'.repeat(filled)}${'─'.repeat(width - filled)}]`;
}

function lines(...values: string[]): string {
  return values.join('\n');
}

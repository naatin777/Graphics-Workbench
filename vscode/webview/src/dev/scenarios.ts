import { createMockChannel, type MockChannel } from '@graphics-workbench/vscode-protocol/typed-protocol';
import { cropPdfProtocol, type CropPdfLabels } from '@graphics-workbench/vscode-protocol/crop-pdf-protocol';
import { mergePdfProtocol, type MergePdfLabels } from '@graphics-workbench/vscode-protocol/merge-pdf-protocol';
import { previewProtocol, type PreviewLabels } from '@graphics-workbench/vscode-protocol/preview-protocol';
import { reorderPdfProtocol, type ReorderPdfLabels } from '@graphics-workbench/vscode-protocol/reorder-pdf-protocol';
import { rotatePdfProtocol, type RotatePdfLabels } from '@graphics-workbench/vscode-protocol/rotate-pdf-protocol';
import { splitPdfProtocol, type SplitPdfLabels } from '@graphics-workbench/vscode-protocol/split-pdf-protocol';
import { tableEditorProtocol, type TableEditorLabels } from '@graphics-workbench/vscode-protocol/table-editor-protocol';

import type { WebviewHost } from '@webview-shared/vscode';

import type { WebviewPageId } from '../app';

export function createScenarioHost(page: WebviewPageId, scenario: string): WebviewHost {
  switch (page) {
    case 'preview': {
      return previewScenarioHost(scenario);
    }
    case 'table-editor': {
      return tableEditorScenarioHost();
    }
    case 'crop-pdf': {
      return cropPdfScenarioHost(scenario);
    }
    case 'merge-pdf': {
      return mergePdfScenarioHost(scenario);
    }
    case 'split-pdf': {
      return splitPdfScenarioHost(scenario);
    }
    case 'rotate-pdf': {
      return rotatePdfScenarioHost(scenario);
    }
    case 'reorder-pdf': {
      return reorderPdfScenarioHost(scenario);
    }
    default: {
      throw new Error(`Unknown demo page: ${String(page)}`);
    }
  }
}

function previewScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(previewProtocol);
  const sendInit = async (): Promise<void> => {
    channel.hostToWebview.send.init({
      format: 'pdf',
      fileName:
        scenario === 'long-filename' ? 'a-very-long-fixture-file-name-for-browser-development.pdf' : 'sample.pdf',
      pageCount: scenario === 'large' ? 8 : 3,
      pdfData: await fixtureBase64Data(scenario === 'large' ? 'multi-page-table.pdf' : 'single-page-document.pdf'),
      resources: pdfJsResources(),
      preview: { maxCanvasPixels: 40_000_000, maxDevicePixelRatio: 2 },
      labels: previewLabels,
    });
  };
  channel.hostToWebview.on({ ready: () => void sendInit() });
  return scenarioHostFor(channel);
}

function tableEditorScenarioHost(): WebviewHost {
  const channel = createMockChannel(tableEditorProtocol);
  channel.hostToWebview.on({
    ready: () => {
      queueMicrotask(() => {
        channel.hostToWebview.send.init({ format: 'latex', labels: tableEditorLabels });
      });
    },
  });
  return scenarioHostFor(channel);
}

function cropPdfScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(cropPdfProtocol);
  channel.hostToWebview.on({
    ready: () => {
      queueMicrotask(() => {
        const pageCount = scenario === 'large' ? 8 : 3;
        channel.hostToWebview.send.init({
          ...pdfPayloadBase(scenario),
          initialPage: 1,
          pageGeometry: Array.from({ length: pageCount }, (_, index) => ({
            page: index + 1,
            mediaBox: { x: 0, y: 0, width: 612, height: 792 },
            cropBox: { x: 0, y: 0, width: 612, height: 792 },
            rotation: 0,
          })),
          initialCropBox: { left: 0, bottom: 0, right: 612, top: 792 },
          labels: cropPdfLabels,
        });
      });
    },
  });
  return scenarioHostFor(channel);
}

function mergePdfScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(mergePdfProtocol);
  const fileName = scenario === 'long-filename' ? 'a-very-long-fixture-file-name.pdf' : 'sample.pdf';
  const pdfSrc = fixtureUrl(scenario === 'large' ? 'multi-page-table.pdf' : 'single-page-document.pdf');
  channel.hostToWebview.on({
    ready: () => {
      queueMicrotask(() => {
        channel.hostToWebview.send.init({
          sources: [
            { sourceId: 'one', fileName, pdfSrc },
            { sourceId: 'two', fileName: 'second.pdf', pdfSrc },
          ],
          resources: pdfJsResources(),
          preview: { maxCanvasPixels: 40_000_000, maxDevicePixelRatio: 2 },
          labels: mergePdfLabels,
        });
      });
    },
  });
  return scenarioHostFor(channel);
}

function splitPdfScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(splitPdfProtocol);
  channel.hostToWebview.on({
    ready: () => {
      queueMicrotask(() => {
        channel.hostToWebview.send.init({
          sourceId: 'browser-fixture',
          ...pdfPayloadBase(scenario),
          outputPathTemplate: 'sample-${page}.pdf',
          labels: splitPdfLabels,
        });
      });
    },
  });
  return scenarioHostFor(channel);
}

function rotatePdfScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(rotatePdfProtocol);
  channel.hostToWebview.on({
    ready: () => {
      queueMicrotask(() => {
        channel.hostToWebview.send.init({
          sourceId: 'browser-fixture',
          ...pdfPayloadBase(scenario),
          labels: rotatePdfLabels,
        });
      });
    },
  });
  return scenarioHostFor(channel);
}

function reorderPdfScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(reorderPdfProtocol);
  channel.hostToWebview.on({
    ready: () => {
      queueMicrotask(() => {
        channel.hostToWebview.send.init({
          sourceId: 'browser-fixture',
          ...pdfPayloadBase(scenario),
          labels: reorderPdfLabels,
        });
      });
    },
  });
  return scenarioHostFor(channel);
}

function scenarioHostFor<HostMessage extends { type: string }, WebviewMessage extends { type: string }>(
  channel: MockChannel<HostMessage, WebviewMessage>,
): WebviewHost {
  let state: unknown;
  return {
    send: channel.deliverWebviewToHost,
    subscribe: (listener) => channel.webviewToHost.subscribe(listener),
    getState: <T>() => state as T | undefined,
    setState: <T>(next: T) => {
      state = next;
    },
  };
}

function pdfPayloadBase(scenario: string): {
  fileName: string;
  pageCount: number;
  pdfSrc: string;
  resources: ReturnType<typeof pdfJsResources>;
  preview: { maxCanvasPixels: number; maxDevicePixelRatio: number };
} {
  return {
    fileName: scenario === 'long-filename' ? 'a-very-long-fixture-file-name.pdf' : 'sample.pdf',
    pageCount: scenario === 'large' ? 8 : 3,
    pdfSrc: fixtureUrl(scenario === 'large' ? 'multi-page-table.pdf' : 'single-page-document.pdf'),
    resources: pdfJsResources(),
    preview: { maxCanvasPixels: 40_000_000, maxDevicePixelRatio: 2 },
  };
}

function pdfJsResources(): { workerSrc: string; cMapUrl: string; standardFontDataUrl: string; wasmUrl: string } {
  return {
    workerSrc: fixtureUrl('../pdfjs/build/pdf.worker.min.mjs'),
    cMapUrl: fixtureUrl('../pdfjs/cmaps/'),
    standardFontDataUrl: fixtureUrl('../pdfjs/standard_fonts/'),
    wasmUrl: fixtureUrl('../pdfjs/wasm/'),
  };
}

function fixtureUrl(name: string): string {
  if (name.startsWith('../')) {
    return new URL(name.slice(2), `${globalThis.location.origin}/`).toString();
  }
  return new URL(`/fixtures/${name}`, globalThis.location.href).toString();
}

async function fixtureBase64Data(name: string): Promise<string> {
  const response = await fetch(fixtureUrl(name));
  if (!response.ok) {
    throw new Error(`Failed to load dev fixture ${name}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

const previewLabels = {
  title: 'Preview',
  description: 'Preview the file contents.',
  page: { label: 'Page', pages: 'pages' },
  preview: {
    ariaLabel: 'Preview',
    zoomLabel: 'Preview zoom',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    renderError: 'Could not display the preview',
  },
} satisfies PreviewLabels;

const tableEditorLabels = {
  header: { title: 'Table Editor', description: 'Create a table from plain text.' },
  input: { unsupportedFile: 'This file is not a supported table.', emptyFile: 'The file is empty.' },
  table: {
    addRow: 'Add row',
    addColumn: 'Add column',
    removeRow: 'Remove row',
    removeColumn: 'Remove column',
    alignmentLabel: 'Alignment',
    alignmentLeft: 'Left',
    alignmentCenter: 'Center',
    alignmentRight: 'Right',
    headerToggle: 'Header row',
  },
  options: {
    formatLabel: 'Format',
    formatLatex: 'LaTeX',
    formatTypst: 'Typst',
    formatQuarkdown: 'Quarkdown',
    booktabs: 'Booktabs',
  },
  preview: { title: 'Preview' },
  actions: { insert: 'Insert' },
} satisfies TableEditorLabels;

const cropPdfLabels = {
  header: { title: 'Crop PDF', description: 'Crop the document.', pageLabel: 'Page', pages: 'pages' },
  preview: {
    title: 'Preview',
    ariaLabel: 'Preview',
    zoomLabel: 'Preview zoom',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    renderError: 'Could not display the preview',
    applyError: 'Could not apply the operation',
  },
  cropBox: {
    settingsLabel: 'Crop settings',
    title: 'Crop box',
    left: 'Left',
    bottom: 'Bottom',
    right: 'Right',
    top: 'Top',
    currentPageSize: 'Current page size',
  },
  targetPages: {
    applyTo: 'Apply to',
    all: 'All pages',
    pages: 'Selected pages',
    inputLabel: 'Pages',
    placeholder: '1-3',
  },
  validation: {
    cropBoxNumber: 'Enter a number.',
    cropBoxSize: 'Crop box is too small.',
    pagesRequired: 'Pages are required.',
    pageWholeNumber: 'Use whole page numbers.',
    pageOutOfRange: 'Page is out of range.',
  },
  actions: { apply: 'Apply', processing: 'Processing', cancel: 'Cancel' },
} satisfies CropPdfLabels;

const mergePdfLabels = {
  header: { title: 'Merge PDF' },
  sources: { list: 'Files', count: 'files' },
  controls: {
    actions: 'Actions',
    dragHandle: 'Drag',
    moveUp: 'Move up',
    moveDown: 'Move down',
    removeSource: 'Remove',
  },
  preview: {
    title: 'Preview',
    ariaLabel: 'Preview',
    loading: 'Loading',
    renderError: 'Could not display the preview',
  },
  actions: { apply: 'Apply', cancel: 'Cancel' },
} satisfies MergePdfLabels;

const splitPdfLabels = {
  header: { title: 'Split PDF', description: 'Split selected pages.' },
  preview: {
    title: 'Preview',
    ariaLabel: 'Preview',
    renderError: 'Could not display the preview',
    applyError: 'Could not apply the operation',
    allPages: 'All pages',
    focusedPages: 'Focused pages',
    zoom: 'Zoom',
  },
  groups: {
    title: 'Groups',
    label: 'Group',
    add: 'Add group',
    remove: 'Remove group',
    drag: 'Drag',
    outputOrder: 'Output order',
  },
  pages: { title: 'Pages', label: 'Page', placeholder: '1-3' },
  output: { name: 'Output name', namePlaceholder: 'part', path: 'Output path' },
  validation: {
    pagesRequired: 'Pages are required.',
    pageWholeNumber: 'Use whole page numbers.',
    pageOutOfRange: 'Page is out of range.',
    invalidPages: 'Invalid pages.',
    descendingPages: 'Pages must be ascending.',
    outputNameEmpty: 'Output name is required.',
    outputNamePath: 'Output name must be a file name.',
    outputNameDuplicate: 'Output names must be unique.',
  },
  actions: { apply: 'Apply', cancel: 'Cancel', moveUp: 'Move up', moveDown: 'Move down' },
} satisfies SplitPdfLabels;

const rotatePdfLabels = {
  header: { title: 'Rotate PDF', description: 'Rotate selected pages.' },
  preview: {
    title: 'Preview',
    description: 'Preview the file contents.',
    ariaLabel: 'Preview',
    renderError: 'Could not display the preview',
    applyError: 'Could not apply the operation',
  },
  rotation: {
    title: 'Rotation',
    angleLabel: 'Angle',
    selectAll: 'Select all',
    selectAllAriaLabel: 'Select all pages',
    pageToggle: 'Page',
  },
  validation: {
    pagesRequired: 'Select at least one page.',
    pageOutOfRange: 'Page is out of range.',
    angleInvalid: 'Invalid angle.',
  },
  actions: { apply: 'Apply', cancel: 'Cancel' },
} satisfies RotatePdfLabels;

const reorderPdfLabels = {
  header: { title: 'Reorder PDF', description: 'Change page order.' },
  preview: {
    title: 'Preview',
    ariaLabel: 'Preview',
    renderError: 'Could not display the preview',
    applyError: 'Could not apply the operation',
  },
  order: { title: 'Order', moveUp: 'Move up', moveDown: 'Move down', positionLabel: 'Position' },
  validation: { orderRequired: 'Add at least one page.', orderInvalid: 'Invalid order.' },
  actions: { apply: 'Apply', cancel: 'Cancel' },
} satisfies ReorderPdfLabels;

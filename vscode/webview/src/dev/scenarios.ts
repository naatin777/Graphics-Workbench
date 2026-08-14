import {
  createMockChannel,
  type MockChannel,
  type MessageCatalog,
} from '@graphics-workbench/vscode-protocol/typed-protocol';
import { cropPdfProtocol } from '@graphics-workbench/vscode-protocol/crop-pdf-protocol';
import { mergePdfProtocol } from '@graphics-workbench/vscode-protocol/merge-pdf-protocol';
import { previewProtocol } from '@graphics-workbench/vscode-protocol/preview-protocol';
import { reorderPdfProtocol } from '@graphics-workbench/vscode-protocol/reorder-pdf-protocol';
import { rotatePdfProtocol } from '@graphics-workbench/vscode-protocol/rotate-pdf-protocol';
import { splitPdfProtocol } from '@graphics-workbench/vscode-protocol/split-pdf-protocol';
import { tableEditorProtocol } from '@graphics-workbench/vscode-protocol/table-editor-protocol';
import type { WebviewPageId } from '@graphics-workbench/vscode-protocol/webview-page';

import type { WebviewHost } from '@webview-shared/vscode';

let catalogPromise: Promise<MessageCatalog> | undefined;
async function messagesCatalog(): Promise<MessageCatalog> {
  catalogPromise ??= fetchMessagesCatalog();
  return catalogPromise;
}
async function fetchMessagesCatalog(): Promise<MessageCatalog> {
  const response = await fetch('/messages.json');
  if (!response.ok) {
    throw new Error(`Failed to load messages catalog: ${response.status}`);
  }
  const value: unknown = await response.json();
  return value as MessageCatalog;
}

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
  channel.host.on({
    ready: () => {
      void sendInit();
    },
  });
  async function sendInit(): Promise<void> {
    channel.host.send.init({
      format: 'pdf',
      fileName:
        scenario === 'long-filename' ? 'a-very-long-testData-file-name-for-browser-development.pdf' : 'sample.pdf',
      pageCount: scenario === 'large' ? 8 : 3,
      pdfSrc: testDataUrl(scenario === 'large' ? 'multi-page-table.pdf' : 'single-page-document.pdf'),
      resources: pdfJsResources(),
      preview: { maxCanvasPixels: 40_000_000, maxDevicePixelRatio: 2 },
      labels: await messagesCatalog(),
    });
  }
  return scenarioHostFor(channel);
}

function tableEditorScenarioHost(): WebviewHost {
  const channel = createMockChannel(tableEditorProtocol);
  channel.host.on({
    ready: () => {
      void sendInit();
    },
  });
  async function sendInit(): Promise<void> {
    channel.host.send.init({ format: 'latex', labels: await messagesCatalog() });
  }
  return scenarioHostFor(channel);
}

function cropPdfScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(cropPdfProtocol);
  channel.host.on({
    ready: () => {
      void sendInit();
    },
  });
  async function sendInit(): Promise<void> {
    const pageCount = scenario === 'large' ? 8 : 3;
    channel.host.send.init({
      ...pdfPayloadBase(scenario),
      initialPage: 1,
      pageGeometry: Array.from({ length: pageCount }, (_, index) => ({
        page: index + 1,
        mediaBox: { x: 0, y: 0, width: 612, height: 792 },
        cropBox: { x: 0, y: 0, width: 612, height: 792 },
        rotation: 0,
      })),
      initialCropBox: { left: 0, bottom: 0, right: 612, top: 792 },
      labels: await messagesCatalog(),
    });
  }
  return scenarioHostFor(channel);
}

function mergePdfScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(mergePdfProtocol);
  const fileName = scenario === 'long-filename' ? 'a-very-long-testData-file-name.pdf' : 'sample.pdf';
  const pdfSrc = testDataUrl(scenario === 'large' ? 'multi-page-table.pdf' : 'single-page-document.pdf');
  channel.host.on({
    ready: () => {
      void sendInit();
    },
  });
  async function sendInit(): Promise<void> {
    channel.host.send.init({
      sources: [
        { sourceId: 'one', fileName, pdfSrc },
        { sourceId: 'two', fileName: 'second.pdf', pdfSrc },
      ],
      resources: pdfJsResources(),
      preview: { maxCanvasPixels: 40_000_000, maxDevicePixelRatio: 2 },
      labels: await messagesCatalog(),
    });
  }
  return scenarioHostFor(channel);
}

function splitPdfScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(splitPdfProtocol);
  channel.host.on({
    ready: () => {
      void sendInit();
    },
  });
  async function sendInit(): Promise<void> {
    channel.host.send.init({
      sourceId: 'browser-testData',
      ...pdfPayloadBase(scenario),
      outputPathTemplate: 'sample-${page}.pdf',
      labels: await messagesCatalog(),
    });
  }
  return scenarioHostFor(channel);
}

function rotatePdfScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(rotatePdfProtocol);
  channel.host.on({
    ready: () => {
      void sendInit();
    },
  });
  async function sendInit(): Promise<void> {
    channel.host.send.init({
      sourceId: 'browser-testData',
      ...pdfPayloadBase(scenario),
      labels: await messagesCatalog(),
    });
  }
  return scenarioHostFor(channel);
}

function reorderPdfScenarioHost(scenario: string): WebviewHost {
  const channel = createMockChannel(reorderPdfProtocol);
  channel.host.on({
    ready: () => {
      void sendInit();
    },
  });
  async function sendInit(): Promise<void> {
    channel.host.send.init({
      sourceId: 'browser-testData',
      ...pdfPayloadBase(scenario),
      labels: await messagesCatalog(),
    });
  }
  return scenarioHostFor(channel);
}

function scenarioHostFor<HostMessage extends { type: string }, WebviewMessage extends { type: string }>(
  channel: MockChannel<HostMessage, WebviewMessage>,
): WebviewHost {
  let state: unknown;
  return {
    send: channel.deliverWebviewToHost,
    subscribe: (listener) => channel.webview.subscribe(listener),
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
    fileName: scenario === 'long-filename' ? 'a-very-long-testData-file-name.pdf' : 'sample.pdf',
    pageCount: scenario === 'large' ? 8 : 3,
    pdfSrc: testDataUrl(scenario === 'large' ? 'multi-page-table.pdf' : 'single-page-document.pdf'),
    resources: pdfJsResources(),
    preview: { maxCanvasPixels: 40_000_000, maxDevicePixelRatio: 2 },
  };
}

function pdfJsResources(): { workerSrc: string; cMapUrl: string; standardFontDataUrl: string; wasmUrl: string } {
  return {
    workerSrc: assetUrl('pdfjs/build/pdf.worker.min.mjs'),
    cMapUrl: assetUrl('pdfjs/cmaps/'),
    standardFontDataUrl: assetUrl('pdfjs/standard_fonts/'),
    wasmUrl: assetUrl('pdfjs/wasm/'),
  };
}

function testDataUrl(name: string): string {
  return new URL(`/testdata/${name}`, globalThis.location.href).toString();
}

function assetUrl(name: string): string {
  return new URL(`/${name}`, globalThis.location.href).toString();
}

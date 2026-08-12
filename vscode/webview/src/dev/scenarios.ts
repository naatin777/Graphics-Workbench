import { MockHost } from '@webview-shared/vscode';

export type DemoPage =
  | 'crop-pdf'
  | 'merge-pdf'
  | 'preview'
  | 'reorder-pdf'
  | 'rotate-pdf'
  | 'split-pdf'
  | 'table-editor';

export function createScenarioHost(page: DemoPage, scenario: string): MockHost {
  const host = new MockHost((message, currentHost) => {
    if (!isMessageWithType(message, 'ready')) {
      return;
    }
    queueMicrotask(() => {
      currentHost.emit(createInitialMessage(page, scenario));
    });
  });
  return host;
}

function isMessageWithType(value: unknown, type: string): boolean {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'type') === type;
}

function createInitialMessage(page: DemoPage, scenario: string): unknown {
  if (page === 'preview') {
    const pageCount = scenario === 'large' ? 8 : 3;
    return {
      type: 'init',
      payload: {
        format: 'pdf',
        fileName:
          scenario === 'long-filename' ? 'a-very-long-fixture-file-name-for-browser-development.pdf' : 'sample.pdf',
        pageCount,
        pdfSrc: fixtureUrl(scenario === 'large' ? 'multi-page-table.pdf' : 'single-page-document.pdf'),
        resources: {},
        preview: { maxCanvasPixels: 40_000_000, maxDevicePixelRatio: 2 },
        labels: {
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
        },
      },
    };
  }

  if (page === 'table-editor') {
    return {
      type: 'init',
      payload: {
        format: 'latex',
        labels: {
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
        },
      },
    };
  }

  const base = {
    sourceId: 'browser-fixture',
    fileName: scenario === 'long-filename' ? 'a-very-long-fixture-file-name.pdf' : 'sample.pdf',
    pageCount: scenario === 'large' ? 8 : 3,
    pdfSrc: fixtureUrl(scenario === 'large' ? 'multi-page-table.pdf' : 'single-page-document.pdf'),
    resources: {
      workerSrc: fixtureUrl('../pdfjs/build/pdf.worker.min.mjs'),
      cMapUrl: fixtureUrl('../pdfjs/cmaps/'),
      standardFontDataUrl: fixtureUrl('../pdfjs/standard_fonts/'),
      wasmUrl: fixtureUrl('../pdfjs/wasm/'),
    },
    preview: { maxCanvasPixels: 40_000_000, maxDevicePixelRatio: 2 },
  };

  const labels = labelsFor(page);
  if (page === 'crop-pdf') {
    return {
      type: 'init',
      payload: {
        ...base,
        initialPage: 1,
        pageGeometry: [
          {
            page: 1,
            mediaBox: { x: 0, y: 0, width: 612, height: 792 },
            cropBox: { x: 0, y: 0, width: 612, height: 792 },
            rotation: 0,
          },
        ],
        initialCropBox: { left: 0, bottom: 0, right: 612, top: 792 },
        labels,
      },
    };
  }
  if (page === 'merge-pdf') {
    return {
      type: 'init',
      payload: {
        sources: [
          { ...base, sourceId: 'one' },
          { ...base, sourceId: 'two', fileName: 'second.pdf' },
        ],
        resources: base.resources,
        preview: base.preview,
        labels,
      },
    };
  }
  if (page === 'split-pdf') {
    return { type: 'init', payload: { ...base, outputPathTemplate: 'sample-${page}.pdf', labels } };
  }
  return { type: 'init', payload: { ...base, labels } };
}

function fixtureUrl(name: string): string {
  if (name.startsWith('../')) {
    return new URL(name.slice(2), `${globalThis.location.origin}/`).toString();
  }
  return new URL(`/fixtures/${name}`, globalThis.location.href).toString();
}

function labelsFor(page: Exclude<DemoPage, 'preview' | 'table-editor'>): Record<string, unknown> {
  const commonPreview = {
    title: 'Preview',
    description: 'Preview the file contents.',
    ariaLabel: 'Preview',
    renderError: 'Could not display the preview',
    applyError: 'Could not apply the operation',
  };
  const actions = { apply: 'Apply', cancel: 'Cancel' };
  if (page === 'merge-pdf') {
    return {
      header: { title: 'Merge PDF' },
      sources: { list: 'Files', count: 'files' },
      controls: {
        actions: 'Actions',
        dragHandle: 'Drag',
        moveUp: 'Move up',
        moveDown: 'Move down',
        removeSource: 'Remove',
      },
      preview: { ...commonPreview, loading: 'Loading' },
      actions,
    };
  }
  if (page === 'rotate-pdf') {
    return {
      header: { title: 'Rotate PDF', description: 'Rotate selected pages.' },
      preview: commonPreview,
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
      actions,
    };
  }
  if (page === 'reorder-pdf') {
    return {
      header: { title: 'Reorder PDF', description: 'Change page order.' },
      preview: commonPreview,
      order: { title: 'Order', moveUp: 'Move up', moveDown: 'Move down', positionLabel: 'Position' },
      validation: { orderRequired: 'Add at least one page.', orderInvalid: 'Invalid order.' },
      actions,
    };
  }
  if (page === 'split-pdf') {
    return {
      header: { title: 'Split PDF', description: 'Split selected pages.' },
      preview: { ...commonPreview, allPages: 'All pages', focusedPages: 'Focused pages', zoom: 'Zoom' },
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
      actions: { ...actions, moveUp: 'Move up', moveDown: 'Move down' },
    };
  }
  return {
    header: { title: 'Crop PDF', description: 'Crop the document.' },
    preview: commonPreview,
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
    actions: { ...actions, processing: 'Processing' },
  };
}

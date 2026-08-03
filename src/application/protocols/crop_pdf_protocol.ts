export interface CropBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface PdfRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfPageRotation = 0 | 90 | 180 | 270;

export interface PdfPageGeometry {
  page: number;
  mediaBox: PdfRectangle;
  cropBox: PdfRectangle;
  rotation: PdfPageRotation;
}

export type CropTarget = { type: 'all' } | { type: 'selected'; pages: number[] };

export interface CropPdfLabels {
  header: {
    title: string;
    description: string;
    pageLabel: string;
    pages: string;
  };
  preview: {
    title: string;
    description: string;
    ariaLabel: string;
    zoomLabel: string;
    zoomOut: string;
    zoomIn: string;
    renderError: string;
    applyError: string;
  };
  cropBox: {
    settingsLabel: string;
    title: string;
    description: string;
    left: string;
    bottom: string;
    right: string;
    top: string;
    currentPageSize: string;
  };
  targetPages: {
    title: string;
    all: string;
    selected: string;
    inputLabel: string;
    placeholder: string;
  };
  validation: {
    cropBoxNumber: string;
    cropBoxSize: string;
    pagesRequired: string;
    pageWholeNumber: string;
    pageOutOfRange: string;
  };
  actions: {
    apply: string;
    cancel: string;
  };
}

export type CropConfigureHostToWebview =
  | {
      type: 'init';
      payload: {
        pdfSrc: string;
        resources: {
          workerSrc?: string;
          cMapUrl?: string;
          standardFontDataUrl?: string;
          wasmUrl?: string;
        };
        fileName: string;
        pageCount: number;
        initialPage: number;
        pageGeometry: PdfPageGeometry[];
        initialCropBox: CropBox;
        labels: CropPdfLabels;
      };
    }
  | {
      type: 'error';
      payload: { message: string };
    };

export type CropConfigureWebviewToHost =
  | { type: 'ready' }
  | {
      type: 'apply';
      payload: { cropBox: CropBox; target: CropTarget };
    }
  | { type: 'cancel' }
  | {
      type: 'previewLoadFailed';
      payload: { message: string };
    };

function readProperty(object: object, key: string): unknown {
  return Reflect.get(object, key) as unknown;
}

export function isCropConfigureMessage(value: unknown): value is CropConfigureWebviewToHost {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  if (value.type === 'ready' || value.type === 'cancel') {
    return true;
  }

  if (value.type === 'previewLoadFailed') {
    return (
      'payload' in value &&
      typeof value.payload === 'object' &&
      value.payload !== null &&
      'message' in value.payload &&
      typeof value.payload.message === 'string'
    );
  }

  if (value.type !== 'apply' || !('payload' in value)) {
    return false;
  }

  if (typeof value.payload !== 'object' || value.payload === null) {
    return false;
  }

  return (
    'cropBox' in value.payload &&
    isCropBox(value.payload.cropBox) &&
    'target' in value.payload &&
    isCropTarget(value.payload.target)
  );
}

function isCropBox(value: unknown): value is CropBox {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return ['left', 'bottom', 'right', 'top'].every((key) => {
    const coordinate = readProperty(value, key);
    return typeof coordinate === 'number' && Number.isFinite(coordinate);
  });
}

function isCropTarget(value: unknown): value is CropTarget {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }

  if (value.type === 'all') {
    return true;
  }

  return (
    value.type === 'selected' &&
    'pages' in value &&
    Array.isArray(value.pages) &&
    value.pages.every((page) => Number.isInteger(page) && page > 0)
  );
}

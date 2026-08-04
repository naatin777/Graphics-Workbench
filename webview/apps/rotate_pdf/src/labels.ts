import type { RotatePdfLabels } from '@graphics-workbench-rotate-pdf-protocol';

export const defaultLabels: RotatePdfLabels = {
  header: {
    title: 'Rotate PDF',
    description: 'Select the pages to rotate and the rotation angle.',
  },
  preview: {
    title: 'PDF Preview',
    description: 'Pages selected for rotation.',
    ariaLabel: 'PDF page preview',
    renderError: 'Failed to render the PDF preview.',
    applyError: 'Failed to apply the rotation.',
  },
  rotation: {
    title: 'Rotation',
    angleLabel: 'Rotation angle',
    selectAll: 'Select all pages',
    selectAllAriaLabel: 'Toggle selection of all pages',
    pageToggle: 'Toggle page selection',
  },
  validation: {
    pagesRequired: 'Select at least one page to rotate.',
    pageOutOfRange: 'A selected page is out of range.',
    angleInvalid: 'Select a rotation angle.',
  },
  actions: {
    apply: 'Apply',
    cancel: 'Cancel',
  },
};

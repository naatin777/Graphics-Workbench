import type { MergePdfLabels } from './messages';

export const defaultLabels: MergePdfLabels = {
  header: {
    title: 'Merge PDFs',
    description: 'Arrange the PDF files, then merge them in the displayed order.',
  },
  sources: {
    list: 'PDF files',
    listDescription: 'Drag files to change their order.',
    count: 'files selected',
  },
  controls: {
    actions: 'Actions',
    dragHandle: 'Drag to reorder',
    moveUp: 'Move up',
    moveDown: 'Move down',
    removeSource: 'Remove from list',
  },
  preview: {
    title: 'Preview',
    ariaLabel: 'First page preview',
    loading: 'Loading preview...',
    renderError: 'Preview unavailable',
  },
  actions: {
    apply: 'Merge',
    cancel: 'Cancel',
  },
};

import { defineWebviewConfig } from '../../vite.config';

export default defineWebviewConfig({
  appName: 'reorder_pdf',
  copyPdfWorker: true,
});

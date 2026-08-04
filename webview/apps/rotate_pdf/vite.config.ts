import { defineWebviewConfig } from '../../vite.config';

export default defineWebviewConfig({
  appName: 'rotate_pdf',
  copyPdfWorker: true,
});

// oxlint-disable-next-line unicorn/prefer-export-from -- pdfjs is used locally and re-exported as the app's namespace.
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs';

export { pdfjs };

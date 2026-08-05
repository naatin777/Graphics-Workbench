import { readFile } from 'node:fs/promises';

import { PDFDocument } from 'pdf-lib';

import type { ConversionExecutionContext } from '../../operations/lifecycle/conversion_runtime.js';
import { userMessage } from '../shared/user_messages.js';
import { planPdfPageJobs } from './plan_pdf_page_jobs.js';

/** PDFを読み込んでpage countを解析し、形式固有のjobへ変換する。 */
export async function planPdfPageConversionJobs<Job>(options: {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  runtime?: ConversionExecutionContext | undefined;
  createJob: (page: number, outputPath: string) => Job;
}): Promise<Job[]> {
  options.runtime?.signal?.throwIfAborted();
  options.runtime?.reportMessage?.(userMessage('message.progress.analyzingPdf'));
  const document = await PDFDocument.load(await readFile(options.sourcePath));
  const pageCount = document.getPageCount();

  const jobs: Job[] = [];
  for (const { page, outputPath } of planPdfPageJobs(
    {
      sourcePath: options.sourcePath,
      workspacePath: options.workspacePath,
      workspaceName: options.workspaceName,
    },
    pageCount,
    options.outputTemplate,
    options.allowedExtensions,
  )) {
    options.runtime?.signal?.throwIfAborted();
    jobs.push(options.createJob(page, outputPath));
  }
  return jobs;
}

import { readFile } from 'node:fs/promises';

import { countPdfPages } from '../../operations/pdf/mupdf.js';

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
  runtime?: ConversionExecutionContext;
  toJob: (page: number, outputPath: string) => Job;
}): Promise<Job[]> {
  options.runtime?.signal?.throwIfAborted();
  options.runtime?.reportMessage?.(userMessage('message.progress.analyzingPdf'));
  const pageCount = await countPdfPages(await readFile(options.sourcePath));

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
    jobs.push(options.toJob(page, outputPath));
  }
  return jobs;
}

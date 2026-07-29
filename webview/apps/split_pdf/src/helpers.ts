import type { SplitPdfLabels } from '@graphics-workbench-split-pdf-protocol';

import type { PageParseFailure } from './pages';

export function formatLabel(template: string, value: string): string {
  return template.replace('{0}', value);
}

export function pageFailureMessage(failure: PageParseFailure, labels: SplitPdfLabels): string {
  if (failure.kind === 'required') {
    return labels.validation.pagesRequired;
  }

  if (failure.kind === 'wholeNumber' || failure.kind === 'malformed') {
    return failure.kind === 'wholeNumber'
      ? formatLabel(labels.validation.pageWholeNumber, failure.token)
      : formatLabel(labels.validation.invalidPages, failure.token);
  }

  if (failure.kind === 'descending') {
    return formatLabel(labels.validation.descendingPages, failure.token);
  }

  return formatLabel(labels.validation.pageOutOfRange, failure.token);
}

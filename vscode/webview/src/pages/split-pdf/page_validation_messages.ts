import type { PdfPageSelectionParseFailure } from '@graphics-workbench/core/formats';
import type { MessageReader } from '@webview-shared/messages';

export function formatLabel(template: string, value: string): string {
  return template.replace('{0}', value);
}

export function formatPageParseFailure(failure: PdfPageSelectionParseFailure, t: MessageReader): string {
  if (failure.kind === 'required') {
    return t('webview.splitPdf.pagesRequiredError');
  }

  if (failure.kind === 'wholeNumber' || failure.kind === 'malformed') {
    return failure.kind === 'wholeNumber'
      ? formatLabel(t('webview.splitPdf.pageWholeNumberError'), failure.token)
      : formatLabel(t('webview.splitPdf.invalidPages'), failure.token);
  }

  if (failure.kind === 'descending') {
    return formatLabel(t('webview.splitPdf.descendingPages'), failure.token);
  }

  return formatLabel(t('webview.splitPdf.pageOutOfRangeError'), failure.token);
}

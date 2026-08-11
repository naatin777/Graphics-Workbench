type PdfPageSelectionParseFailureKind = 'required' | 'malformed' | 'wholeNumber' | 'descending' | 'outOfRange';

export type PdfPageSelectionParseFailure = {
  ok: false;
  kind: PdfPageSelectionParseFailureKind;
  token: string;
};

export type PdfPageSelectionParseResult = { ok: true; pages: number[] } | PdfPageSelectionParseFailure;

export function parsePdfPageSelection(raw: string, pageCount: number): PdfPageSelectionParseResult {
  if (raw.trim().length === 0) {
    return { ok: false, kind: 'required', token: raw };
  }

  const pages: number[] = [];

  for (const rawToken of raw.split(',')) {
    const token = rawToken.trim();

    if (token.length === 0) {
      return { ok: false, kind: 'malformed', token: rawToken };
    }

    if (/^\d+$/.test(token)) {
      const page = Number(token);

      if (!Number.isSafeInteger(page)) {
        return { ok: false, kind: 'wholeNumber', token };
      }

      if (page < 1 || page > pageCount) {
        return { ok: false, kind: 'outOfRange', token };
      }

      pages.push(page);
      continue;
    }

    const range = /^(\d+)\s*-\s*(\d*)$/.exec(token) ?? /^-\s*(\d+)$/.exec(token);

    if (!range) {
      return { ok: false, kind: token.includes('.') ? 'wholeNumber' : 'malformed', token };
    }

    const isLeadingOpenRange = token.startsWith('-');
    const start = Number(isLeadingOpenRange ? '1' : range[1]);
    const rangeEnd = range[2] === '' ? pageCount.toString() : range[2];
    const end = Number(isLeadingOpenRange ? range[1] : rangeEnd);

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      return { ok: false, kind: 'wholeNumber', token };
    }

    if (end < start) {
      return { ok: false, kind: 'descending', token };
    }

    if (start < 1 || end > pageCount) {
      return { ok: false, kind: 'outOfRange', token };
    }

    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }
  }

  return { ok: true, pages };
}

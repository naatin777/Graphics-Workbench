/**
 * 区切りテキストのパーサー。
 *
 * - parseCsv: quoted field / 引用符内のカンマ / ""エスケープ / CRLF / LF / 空セル / 末尾の空セルに対応する。
 * - parseTsv: Excel / Google Sheetsのclipboard TSVを想定し、タブ区切り・CRLF / LF・空セルに対応する。
 */

export function parseCsv(text: string): string[][] {
  if (text.length === 0) {
    return [];
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let endsWithNewline = false;
  let index = 0;
  while (index < text.length) {
    const character = text.charAt(index);
    if (inQuotes) {
      if (character === '"') {
        const next = text[index + 1];
        if (next === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      index += 1;
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      endsWithNewline = true;
      index += 1;
      continue;
    }
    if (character === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      endsWithNewline = true;
      index += 1;
      if (text[index] === '\n') {
        index += 1;
      }
      continue;
    }
    field += character;
    endsWithNewline = false;
    index += 1;
  }
  if (!endsWithNewline) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseTsv(text: string): string[][] {
  if (text.length === 0) {
    return [];
  }
  const withoutTrailingNewlines = text.replace(/(?:\r\n|\r|\n)+$/u, '');
  if (withoutTrailingNewlines.length === 0) {
    return [];
  }
  return withoutTrailingNewlines.split(/\r\n|\r|\n/u).map((line) => line.split('\t'));
}

/** タブを含む場合のみtable candidateと判定する保守的な判定。 */
export function isTsvTableCandidate(text: string): boolean {
  return text.includes('\t');
}

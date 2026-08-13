import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function assertSvgStructureMatches(
  actualPath: string,
  expectedPath: string,
  label: string,
): Promise<void> {
  const [actual, expected] = await Promise.all([readFile(actualPath, 'utf8'), readFile(expectedPath, 'utf8')]);
  assert.deepStrictEqual(svgStructureSignature(actual), svgStructureSignature(expected), label);
}

function svgStructureSignature(serialized: string): {
  elementCounts: Record<string, number>;
  labels: string[];
  dataAttributes: Record<string, string[]>;
} {
  const elementCounts: Record<string, number> = {};
  for (const match of serialized.matchAll(/<(circle|ellipse|line|path|polygon|polyline|rect|text)\b/giu)) {
    const elementName = match[1]?.toLowerCase();
    if (elementName !== undefined) {
      elementCounts[elementName] = (elementCounts[elementName] ?? 0) + 1;
    }
  }

  const labels = [...serialized.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/giu)]
    .map((match) => (match[1] === undefined ? undefined : stripSvgTags(match[1]).trim()))
    .filter((label): label is string => label !== undefined && label !== '')
    .toSorted();
  const dataAttributes: Record<string, string[]> = {};
  for (const attribute of ['data-et', 'data-id', 'data-type']) {
    dataAttributes[attribute] = [...serialized.matchAll(new RegExp(`\\b${attribute}="([^"]*)"`, 'gu'))]
      .map((match) => match[1] ?? '')
      .toSorted();
  }

  return { elementCounts, labels, dataAttributes };
}

function stripSvgTags(value: string): string {
  let stripped = value;
  let previous = '';
  while (previous !== stripped) {
    previous = stripped;
    stripped = stripped.replaceAll(/<[^>]+>/gu, '');
  }
  return stripped;
}

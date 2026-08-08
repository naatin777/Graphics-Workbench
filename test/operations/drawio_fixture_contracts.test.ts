import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';

import { isDrawioPath, sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { listInputFixturePaths, testInputDirectory } from '../helpers/fixture_paths.js';
import { requireValue } from '../helpers/required.js';

const xmlParser = new XMLParser({ ignoreAttributes: false });

suite('Draw.io fixtureの契約', () => {
  test('source fixtureはネイティブXMLと埋め込みメタデータを保持する', async () => {
    const drawioDirectory = path.join(testInputDirectory, 'valid', 'drawio');
    const fixturePaths = (await listInputFixturePaths(drawioDirectory)).filter(isDrawioPath);
    assert.deepStrictEqual(
      fixturePaths.map((fixturePath) => path.relative(drawioDirectory, fixturePath)),
      ['embedded-diagram.drawio.svg', 'empty.drawio', 'multi-object-diagram.drawio.png', 'unicode-page-names.drawio'],
    );

    for (const fixturePath of fixturePaths) {
      const format = sourceFormatForPath(fixturePath);
      if (format === 'drawio') {
        await assertNativeDrawioFixture(fixturePath);
      } else if (format === 'editable-drawio-png') {
        await assertEmbeddedPngFixture(fixturePath);
      } else if (format === 'editable-drawio-svg') {
        await assertEmbeddedSvgFixture(fixturePath);
      } else {
        assert.fail(`Unexpected Draw.io fixture format: ${fixturePath}`);
      }
    }
  });
});

async function assertNativeDrawioFixture(fixturePath: string): Promise<void> {
  const source = await readFile(fixturePath, 'utf8');
  xmlParser.parse(source);

  assert.match(source, /^\s*<mxfile\b/u);
  assert.ok(source.includes('<mxCell'));

  if (!source.includes('vertex="1"') && !source.includes('edge="1"')) {
    // Empty page fixture: only the default root cells, no content to crop.
    return;
  }

  assert.strictEqual([...source.matchAll(/<diagram\b/gu)].length, 3);
  assert.ok(source.includes('😀'));
}

async function assertEmbeddedPngFixture(fixturePath: string): Promise<void> {
  const metadata = await sharp(fixturePath).metadata();
  assert.strictEqual(metadata.format, 'png');
  assert.strictEqual(metadata.width, 355);
  assert.strictEqual(metadata.height, 515);
  assert.strictEqual(metadata.channels, 4);

  const mxfileComment = requireValue(metadata.comments?.find(({ keyword }) => keyword === 'mxfile'));
  const embeddedXml = decodeURIComponent(mxfileComment.text);
  await assertEmbeddedXml(embeddedXml);
  assert.match(embeddedXml, /image=data:image\/png,/u);
}

async function assertEmbeddedSvgFixture(fixturePath: string): Promise<void> {
  const source = await readFile(fixturePath, 'utf8');
  xmlParser.parse(source);

  const metadata = await sharp(fixturePath).metadata();
  assert.strictEqual(metadata.format, 'svg');
  assert.strictEqual(metadata.width, 312);
  assert.strictEqual(metadata.height, 525);

  const contentAttribute = requireValue(source.match(/\bcontent="([^"]+)"/u)?.[1]);
  const embeddedXml = decodeXmlAttribute(contentAttribute);
  await assertEmbeddedXml(embeddedXml);
}

async function assertEmbeddedXml(source: string): Promise<void> {
  xmlParser.parse(source);
  assert.match(source, /^<mxfile>\s*<diagram\b/u);
  assert.match(source, /<\/diagram>\s*<\/mxfile>\s*$/u);
}

function decodeXmlAttribute(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

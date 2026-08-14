import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';

import { isDrawioPath, sourceFormatForPath } from '@graphics-workbench/core/formats';
import { listInputTestDataPaths, testInputDirectory, requireValue } from '@graphics-workbench/core/testing';

const xmlParser = new XMLParser({ ignoreAttributes: false });

describe('Draw.io テストデータの保存形式契約', () => {
  it('valid/drawio配下のテストデータを列挙し、native drawioはmxfileで始まるXMLと3つのdiagram・絵文字を、埋め込みPNGは355x515のPNGにmxfileコメントとdata:image/pngのXMLを、埋め込みSVGは312x525のSVGにcontent属性内のXMLを保持していることを検証する', async () => {
    const drawioDirectory = path.join(testInputDirectory, 'valid', 'drawio');
    const testDataPaths = (await listInputTestDataPaths(drawioDirectory)).filter(isDrawioPath);
    assert.deepStrictEqual(
      testDataPaths.map((testDataPath) => path.relative(drawioDirectory, testDataPath)),
      ['embedded-diagram.drawio.svg', 'empty.drawio', 'multi-object-diagram.drawio.png', 'unicode-page-names.drawio'],
    );

    for (const testDataPath of testDataPaths) {
      const format = sourceFormatForPath(testDataPath);
      if (format === 'drawio') {
        await assertNativeDrawioTestData(testDataPath);
      } else if (format === 'drawio-png') {
        await assertEmbeddedPngTestData(testDataPath);
      } else if (format === 'drawio-svg') {
        await assertEmbeddedSvgTestData(testDataPath);
      } else {
        assert.fail(`Unexpected Draw.io テストデータ format: ${testDataPath}`);
      }
    }
  });
});

async function assertNativeDrawioTestData(testDataPath: string): Promise<void> {
  const source = await readFile(testDataPath, 'utf8');
  xmlParser.parse(source);

  assert.match(source, /^\s*<mxfile\b/u);
  assert.ok(source.includes('<mxCell'));

  if (!source.includes('vertex="1"') && !source.includes('edge="1"')) {
    // Empty page テストデータ: only the default root cells, no content to crop.
    return;
  }

  assert.strictEqual([...source.matchAll(/<diagram\b/gu)].length, 3);
  assert.ok(source.includes('😀'));
}

async function assertEmbeddedPngTestData(testDataPath: string): Promise<void> {
  const metadata = await sharp(testDataPath).metadata();
  assert.strictEqual(metadata.format, 'png');
  assert.strictEqual(metadata.width, 355);
  assert.strictEqual(metadata.height, 515);
  assert.strictEqual(metadata.channels, 4);

  const mxfileComment = requireValue(metadata.comments?.find(({ keyword }) => keyword === 'mxfile'));
  const embeddedXml = decodeURIComponent(mxfileComment.text);
  await assertEmbeddedXml(embeddedXml);
  assert.match(embeddedXml, /image=data:image\/png,/u);
}

async function assertEmbeddedSvgTestData(testDataPath: string): Promise<void> {
  const source = await readFile(testDataPath, 'utf8');
  xmlParser.parse(source);

  const metadata = await sharp(testDataPath).metadata();
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

import { readFile } from 'node:fs/promises';

import sharp, { type Sharp } from 'sharp';

export interface DecodedImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

export async function readRgbaPixels(sourcePath: string, page?: number): Promise<DecodedImage> {
  if (sourcePath.endsWith('.raw')) {
    const sidecar = parseRawFixtureSidecar(await readFile(`${sourcePath}.json`, 'utf8'));
    return readRgbaFromSharp(
      sharp(await readFile(sourcePath), {
        raw: { width: sidecar.width, height: sidecar.height, channels: sidecar.channels },
      }),
    );
  }

  const input = page === undefined ? sharp(sourcePath) : sharp(sourcePath, { page: page - 1, pages: 1 });
  return readRgbaFromSharp(input);
}

async function readRgbaFromSharp(input: Sharp): Promise<DecodedImage> {
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

interface RawFixtureSidecar {
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
}

function parseRawFixtureSidecar(serialized: string): RawFixtureSidecar {
  const value: unknown = JSON.parse(serialized);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('width' in value) ||
    !('height' in value) ||
    !('channels' in value) ||
    typeof value.width !== 'number' ||
    typeof value.height !== 'number' ||
    !isRawChannelCount(value.channels)
  ) {
    throw new Error('Invalid Raw fixture sidecar.');
  }

  return { width: value.width, height: value.height, channels: value.channels };
}

function isRawChannelCount(value: unknown): value is RawFixtureSidecar['channels'] {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

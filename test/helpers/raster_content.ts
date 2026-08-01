import sharp, { type Sharp } from 'sharp';

export interface DecodedImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

export interface RgbaDifference {
  differentPixelRatio: number;
  meanChannelDifference: number;
}

export interface RasterComparisonOptions {
  rendererVariance?: boolean;
}

export async function readRgbaPixels(sourcePath: string, page?: number): Promise<DecodedImage> {
  const input = page === undefined ? sharp(sourcePath) : sharp(sourcePath, { page: page - 1, pages: 1 });
  return readRgbaFromSharp(input);
}

export async function readNormalizedRgbaPixels(sourcePath: string): Promise<DecodedImage> {
  return readRgbaFromSharp(
    sharp(sourcePath).resize(512, 512, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    }),
  );
}

export function calculateRgbaDifference(expected: DecodedImage, actual: DecodedImage): RgbaDifference {
  if (expected.width !== actual.width || expected.height !== actual.height || expected.channels !== actual.channels) {
    return { differentPixelRatio: 1, meanChannelDifference: 255 };
  }

  const channels = expected.channels;
  let differentPixels = 0;
  let totalDifference = 0;
  const pixelCount = expected.width * expected.height;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    let maximumChannelDifference = 0;
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const index = pixelIndex * channels + channelIndex;
      const difference = Math.abs((expected.data[index] ?? 0) - (actual.data[index] ?? 0));
      maximumChannelDifference = Math.max(maximumChannelDifference, difference);
      totalDifference += difference;
    }
    if (maximumChannelDifference > 8) {
      differentPixels += 1;
    }
  }

  return {
    differentPixelRatio: differentPixels / pixelCount,
    meanChannelDifference: totalDifference / (pixelCount * channels),
  };
}

async function readRgbaFromSharp(input: Sharp): Promise<DecodedImage> {
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

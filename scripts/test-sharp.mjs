import sharp from 'sharp';

const output = await sharp({
  create: {
    width: 2,
    height: 2,
    channels: 4,
    background: {
      r: 255,
      g: 0,
      b: 0,
      alpha: 1,
    },
  },
})
  .png()
  .toBuffer();

if (!Buffer.isBuffer(output) || output.length === 0) {
  throw new Error('sharp failed to generate a PNG');
}

console.log({
  platform: process.platform,
  arch: process.arch,
  node: process.versions.node,
  napi: process.versions.napi,
  sharp: sharp.versions.sharp,
  vips: sharp.versions.vips,
  outputBytes: output.length,
});

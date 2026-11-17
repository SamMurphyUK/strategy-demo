// 8-bit PNG read and write for the dev baker. Node has no canvas here.
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dul) {
    return left;
  }
  return du <= dul ? up : upLeft;
}

/** Encode straight RGBA into a non-interlaced 8-bit PNG. */
export function encodeRgbaPng(width, height, rgba) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("PNG size is invalid");
  }
  if (rgba.length !== width * height * 4) {
    throw new Error("RGBA buffer has the wrong length");
  }
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    const source = rgba.buffer ? Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength) : Buffer.from(rgba);
    source.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Decode a non-interlaced 8-bit PNG into straight RGBA.
 * Colour types: grey, RGB, grey+alpha, RGBA. Palette and interlaced files throw.
 */
export function decodeRgbaPng(bytes) {
  const png = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (png.length < 8 || !png.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error("The file is not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || interlace !== 0) {
        throw new Error("Only non-interlaced 8-bit PNGs can be quantized");
      }
      if (![0, 2, 4, 6].includes(colorType)) {
        throw new Error("Palette PNGs cannot be quantized");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (width < 1 || height < 1 || colorType < 0 || idat.length === 0) {
    throw new Error("The PNG is missing an image");
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const stride = width * bpp;
  const inflated = inflateSync(Buffer.concat(idat));
  if (inflated.length < height * (stride + 1)) {
    throw new Error("The PNG image data is short");
  }
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? raw[y * stride + x - bpp] : 0;
      const up = y > 0 ? raw[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? raw[(y - 1) * stride + x - bpp] : 0;
      const value = inflated[row + x];
      let sample = value;
      if (filter === 1) {
        sample = (value + left) & 255;
      } else if (filter === 2) {
        sample = (value + up) & 255;
      } else if (filter === 3) {
        sample = (value + Math.floor((left + up) / 2)) & 255;
      } else if (filter === 4) {
        sample = (value + paeth(left, up, upLeft)) & 255;
      } else if (filter !== 0) {
        throw new Error(`PNG filter ${filter} is not supported`);
      }
      raw[y * stride + x] = sample;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const source = i * bpp;
    const dest = i * 4;
    if (colorType === 6) {
      rgba[dest] = raw[source];
      rgba[dest + 1] = raw[source + 1];
      rgba[dest + 2] = raw[source + 2];
      rgba[dest + 3] = raw[source + 3];
    } else if (colorType === 2) {
      rgba[dest] = raw[source];
      rgba[dest + 1] = raw[source + 1];
      rgba[dest + 2] = raw[source + 2];
      rgba[dest + 3] = 255;
    } else if (colorType === 4) {
      rgba[dest] = raw[source];
      rgba[dest + 1] = raw[source];
      rgba[dest + 2] = raw[source];
      rgba[dest + 3] = raw[source + 1];
    } else {
      rgba[dest] = raw[source];
      rgba[dest + 1] = raw[source];
      rgba[dest + 2] = raw[source];
      rgba[dest + 3] = 255;
    }
  }
  return { width, height, data: rgba };
}

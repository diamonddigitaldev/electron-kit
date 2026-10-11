"use strict";

// A PNG writer for the sidebar's tests: an image's RGBA pixels as an 8-bit
// RGB or RGBA PNG, each row with the filter asked for, so the reader is tried
// on every filter.

const zlib = require("zlib");

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, body) {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "latin1");
    body.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(body, zlib.crc32(type)), 8 + body.length);
    return out;
}

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

/**
 * @param {{ width: number, height: number, data: Uint8Array }} image - RGBA, rows top-down
 * @param {{ alpha?: boolean, filter?: number | ((y: number) => number), depth?: number, colourType?: number, interlace?: number }} [options]
 *   filter: 0–4 for every row, or a function of the row. depth, colourType and interlace
 *   only change the header, to make PNGs the reader refuses.
 */
function encodePng(image, options = {}) {
    const { width, height, data } = image;
    const alpha = options.alpha !== false;
    const channels = alpha ? 4 : 3;
    const stride = width * channels;
    const rows = Buffer.alloc(stride * height);
    for (let p = 0, o = 0; p < width * height; p++) {
        for (let ch = 0; ch < channels; ch++) rows[o++] = data[p * 4 + ch];
    }
    const filterOf = typeof options.filter === "function" ? options.filter : () => options.filter ?? 0;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        const filter = filterOf(y);
        raw[y * (stride + 1)] = filter;
        for (let x = 0; x < stride; x++) {
            const value = rows[y * stride + x];
            const a = x >= channels ? rows[y * stride + x - channels] : 0;
            const b = y > 0 ? rows[(y - 1) * stride + x] : 0;
            const c = x >= channels && y > 0 ? rows[(y - 1) * stride + x - channels] : 0;
            const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
            raw[y * (stride + 1) + 1 + x] = (value - predicted) & 0xff;
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = options.depth ?? 8;
    header[9] = options.colourType ?? (alpha ? 6 : 2);
    header[12] = options.interlace ?? 0;
    return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

module.exports = { encodePng };

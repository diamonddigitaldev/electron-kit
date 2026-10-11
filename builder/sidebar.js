"use strict";

// The installer's sidebar: the 164 × 314 picture on the left of the welcome
// and finish pages, the installer's and the uninstaller's, made from the app's
// icon and colour. config() makes it at build time, so every app has its own
// and none ships electron-builder's stock one.
//
// The icon is scaled down (each pixel the average of the area it covers) and
// centred, with a drop shadow, on a gradient in the colour with soft, blurred
// shapes. The colour is the app's --accent, the most common colour in its
// logo, or one the app gives.
//
// It's the kit's own code, with no image library (a kit dependency would be
// packed into every app): a reader for the PNGs app icons are (8-bit RGB or
// RGBA, not interlaced), on Node's zlib, and a writer for the 24-bit BMP NSIS
// wants. The same icon and colour always make the same bytes.

const zlib = require("zlib");

/** The sidebar's size, NSIS's Modern UI's. */
const WIDTH = 164;
const HEIGHT = 314;

/** The longest side the icon is scaled to. */
const ICON_SIZE = 104;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** What a PNG the sidebar can't read should be saved as instead. */
const REEXPORT = "Save it again as an 8-bit RGBA PNG (8 bits a channel, with alpha) that isn't interlaced, as most editors do by default.";

/**
 * Read a PNG into its size and pixels, 8-bit RGBA, rows top-down. Reads 8-bit
 * RGB and RGBA, not interlaced; refuses any other with a message saying how
 * to save it again.
 * @param {Buffer} buffer
 * @param {string} [name] - the file, for the messages
 * @returns {{ width: number, height: number, data: Buffer }}
 */
function readPng(buffer, name = "The PNG") {
    const fail = (why) => {
        throw new Error(`${name} ${why}`);
    };
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) fail("isn't a PNG.");

    let header;
    const idat = [];
    for (let at = 8; ;) {
        if (at + 12 > buffer.length) fail("ends early: it's damaged.");
        const length = buffer.readUInt32BE(at);
        const type = buffer.toString("latin1", at + 4, at + 8);
        if (at + 12 + length > buffer.length) fail("ends early: it's damaged.");
        const body = buffer.subarray(at + 8, at + 8 + length);
        if (zlib.crc32(body, zlib.crc32(type)) !== buffer.readUInt32BE(at + 8 + length)) fail(`has a damaged ${type} chunk.`);
        at += 12 + length;

        if (type === "IHDR") {
            header = {
                width: body.readUInt32BE(0),
                height: body.readUInt32BE(4),
                depth: body[8],
                colourType: body[9],
                interlace: body[12],
            };
        } else if (type === "IDAT") {
            idat.push(body);
        } else if (type === "IEND") {
            break;
        }
    }
    if (!header || idat.length === 0) fail("has no image in it: it's damaged.");

    const { width, height, depth, colourType, interlace } = header;
    const kinds = { 0: "greyscale", 2: "RGB", 3: "palette (indexed colour)", 4: "greyscale with alpha", 6: "RGBA" };
    if (colourType !== 2 && colourType !== 6) fail(`is a ${kinds[colourType] ?? "kind of"} PNG; the sidebar reads RGB and RGBA. ${REEXPORT}`);
    if (depth !== 8) fail(`has ${depth} bits a channel; the sidebar reads 8. ${REEXPORT}`);
    if (interlace !== 0) fail(`is interlaced; the sidebar reads PNGs that aren't. ${REEXPORT}`);
    if (width === 0 || height === 0) fail("is empty.");

    const channels = colourType === 6 ? 4 : 3;
    const stride = width * channels;
    let raw;
    try {
        raw = zlib.inflateSync(Buffer.concat(idat));
    } catch {
        fail("has damaged image data.");
    }
    if (raw.length < (stride + 1) * height) fail("has less image data than its size needs: it's damaged.");

    // Each row starts with its filter: how each byte was written relative to its neighbours.
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const src = y * (stride + 1) + 1;
        const row = y * stride;
        const above = row - stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? pixels[row + x - channels] : 0;
            const b = y > 0 ? pixels[above + x] : 0;
            const c = x >= channels && y > 0 ? pixels[above + x - channels] : 0;
            let predicted;
            switch (filter) {
                case 0: predicted = 0; break;
                case 1: predicted = a; break;
                case 2: predicted = b; break;
                case 3: predicted = (a + b) >> 1; break;
                case 4: predicted = paeth(a, b, c); break;
                default: fail(`has a row with filter ${filter}, which PNG doesn't have: it's damaged.`);
            }
            pixels[row + x] = (raw[src + x] + predicted) & 0xff;
        }
    }

    if (channels === 4) return { width, height, data: pixels };
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
        data[j] = pixels[i];
        data[j + 1] = pixels[i + 1];
        data[j + 2] = pixels[i + 2];
        data[j + 3] = 255;
    }
    return { width, height, data };
}

/** PNG's Paeth predictor: whichever of left, above and above-left is nearest left + above − above-left. */
function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

/**
 * The most common colour in an image, from its opaque pixels, leaving out
 * near-white, near-black and grey: the pixels are counted in buckets of
 * similar colours, and the fullest bucket's average is returned.
 * @param {{ width: number, height: number, data: Buffer }} image
 * @returns {{ r: number, g: number, b: number } | null} null when no pixel counts
 */
function logoColour(image) {
    const buckets = new Map();
    const { data } = image;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 240) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (min >= 235 || max <= 24 || max - min < 24) continue;
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
        bucket.count++;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
    }
    let best = null;
    let bestKey = -1;
    for (const [key, bucket] of buckets) {
        // The lower key on a tie, so the answer never depends on the order the pixels came in.
        if (!best || bucket.count > best.count || (bucket.count === best.count && key < bestKey)) {
            best = bucket;
            bestKey = key;
        }
    }
    if (!best) return null;
    return { r: Math.round(best.r / best.count), g: Math.round(best.g / best.count), b: Math.round(best.b / best.count) };
}

/**
 * Scale an image to fit a square of size × size, each new pixel the average
 * of the area of the old ones it covers, weighted by how much of each it
 * covers, with the colours weighted by their alpha (so a see-through pixel's
 * colour never darkens an edge). Returns premultiplied RGBA floats, 0–1.
 * @param {{ width: number, height: number, data: Buffer }} image
 * @param {number} size
 */
function scaleDown(image, size) {
    const scale = Math.min(1, size / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const xRatio = image.width / width;
    const yRatio = image.height / height;
    const out = new Float64Array(width * height * 4);

    for (let y = 0; y < height; y++) {
        const top = y * yRatio;
        const bottom = top + yRatio;
        for (let x = 0; x < width; x++) {
            const left = x * xRatio;
            const right = left + xRatio;
            let r = 0, g = 0, b = 0, a = 0;
            for (let sy = Math.floor(top); sy < Math.min(image.height, Math.ceil(bottom)); sy++) {
                const wy = Math.min(bottom, sy + 1) - Math.max(top, sy);
                for (let sx = Math.floor(left); sx < Math.min(image.width, Math.ceil(right)); sx++) {
                    const w = wy * (Math.min(right, sx + 1) - Math.max(left, sx));
                    const i = (sy * image.width + sx) * 4;
                    const alpha = image.data[i + 3] / 255;
                    r += w * alpha * image.data[i] / 255;
                    g += w * alpha * image.data[i + 1] / 255;
                    b += w * alpha * image.data[i + 2] / 255;
                    a += w * alpha;
                }
            }
            const area = xRatio * yRatio;
            const o = (y * width + x) * 4;
            out[o] = r / area;
            out[o + 1] = g / area;
            out[o + 2] = b / area;
            out[o + 3] = a / area;
        }
    }
    return { width, height, data: out };
}

/**
 * Blur each channel of a float image in place: three box blurs of the radius,
 * across then down, which comes close to a Gaussian. Pixels past the edge are
 * the edge's.
 * @param {Float64Array} data
 * @param {number} width
 * @param {number} height
 * @param {number} channels
 * @param {number} radius
 */
function blur(data, width, height, channels, radius) {
    const line = new Float64Array(Math.max(width, height));
    const pass = (count, length, at) => {
        for (let n = 0; n < count; n++) {
            for (let ch = 0; ch < channels; ch++) {
                for (let i = 0; i < length; i++) line[i] = data[at(n, i) * channels + ch];
                let sum = 0;
                for (let k = -radius; k <= radius; k++) sum += line[Math.min(length - 1, Math.max(0, k))];
                for (let i = 0; i < length; i++) {
                    data[at(n, i) * channels + ch] = sum / (2 * radius + 1);
                    sum += line[Math.min(length - 1, i + radius + 1)] - line[Math.max(0, i - radius)];
                }
            }
        }
    };
    for (let round = 0; round < 3; round++) {
        pass(height, width, (y, x) => y * width + x);
        pass(width, height, (x, y) => y * width + x);
    }
}

/** A colour, 0–255 a channel, mixed toward another by t (0 keeps it, 1 is the other). */
const mix = (from, to, t) => ({ r: from.r + (to.r - from.r) * t, g: from.g + (to.g - from.g) * t, b: from.b + (to.b - from.b) * t });

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

/**
 * The sidebar's pixels: the background in the colour, then the icon's shadow,
 * then the icon. RGB floats, 0–1, rows top-down.
 * @param {{ width: number, height: number, data: Buffer }} icon - from readPng()
 * @param {{ r: number, g: number, b: number }} colour - 0–255 a channel
 */
function paint(icon, colour) {
    const pixels = new Float64Array(WIDTH * HEIGHT * 3);
    const top = mix(colour, WHITE, 0.22);
    const bottom = mix(colour, BLACK, 0.38);

    // A gradient from a light tint at the top left to a deep shade at the bottom right,
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const t = Math.min(1, Math.max(0, (y / HEIGHT) * 0.85 + (x / WIDTH) * 0.15));
            const c = mix(top, bottom, t);
            const i = (y * WIDTH + x) * 3;
            pixels[i] = c.r / 255;
            pixels[i + 1] = c.g / 255;
            pixels[i + 2] = c.b / 255;
        }
    }
    // with soft shapes on it: lighter and darker circles, blurred to glows.
    const shapes = [
        { x: 0.05, y: 0.12, radius: 0.55, colour: mix(colour, WHITE, 0.45), alpha: 0.55 },
        { x: 1.05, y: 0.42, radius: 0.45, colour: mix(colour, WHITE, 0.25), alpha: 0.35 },
        { x: 0.15, y: 0.78, radius: 0.6, colour: mix(colour, BLACK, 0.45), alpha: 0.45 },
        { x: 0.95, y: 1.0, radius: 0.5, colour: mix(colour, BLACK, 0.2), alpha: 0.4 },
    ];
    for (const shape of shapes) {
        const cx = shape.x * WIDTH;
        const cy = shape.y * HEIGHT;
        const radius = shape.radius * WIDTH;
        for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(HEIGHT, Math.ceil(cy + radius)); y++) {
            for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(WIDTH, Math.ceil(cx + radius)); x++) {
                if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > radius ** 2) continue;
                const i = (y * WIDTH + x) * 3;
                pixels[i] += (shape.colour.r / 255 - pixels[i]) * shape.alpha;
                pixels[i + 1] += (shape.colour.g / 255 - pixels[i + 1]) * shape.alpha;
                pixels[i + 2] += (shape.colour.b / 255 - pixels[i + 2]) * shape.alpha;
            }
        }
    }
    blur(pixels, WIDTH, HEIGHT, 3, 18);

    // The icon, centred, over its shadow: its own shape, lower down, blurred and see-through black.
    const scaled = scaleDown(icon, ICON_SIZE);
    const left = Math.round((WIDTH - scaled.width) / 2);
    const top0 = Math.round((HEIGHT - scaled.height) / 2);
    const shadow = new Float64Array(WIDTH * HEIGHT);
    const drop = 5;
    for (let y = 0; y < scaled.height; y++) {
        for (let x = 0; x < scaled.width; x++) {
            const sy = top0 + y + drop;
            const sx = left + x;
            if (sy < HEIGHT && sx < WIDTH) shadow[sy * WIDTH + sx] = scaled.data[(y * scaled.width + x) * 4 + 3];
        }
    }
    blur(shadow, WIDTH, HEIGHT, 1, 4);
    for (let p = 0; p < WIDTH * HEIGHT; p++) {
        const keep = 1 - shadow[p] * 0.45;
        pixels[p * 3] *= keep;
        pixels[p * 3 + 1] *= keep;
        pixels[p * 3 + 2] *= keep;
    }
    for (let y = 0; y < scaled.height; y++) {
        for (let x = 0; x < scaled.width; x++) {
            const s = (y * scaled.width + x) * 4;
            const p = ((top0 + y) * WIDTH + left + x) * 3;
            const a = scaled.data[s + 3];
            // Premultiplied: the icon's colour plus what shows through it.
            pixels[p] = scaled.data[s] + pixels[p] * (1 - a);
            pixels[p + 1] = scaled.data[s + 1] + pixels[p + 1] * (1 - a);
            pixels[p + 2] = scaled.data[s + 2] + pixels[p + 2] * (1 - a);
        }
    }
    return pixels;
}

/**
 * A 24-bit BMP of RGB floats (0–1, rows top-down): the file's rows bottom-up,
 * blue, green, red, each row padded to 4 bytes.
 * @param {Float64Array} pixels
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function writeBmp(pixels, width, height) {
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const imageSize = rowSize * height;
    const bmp = Buffer.alloc(54 + imageSize);
    bmp.write("BM", 0, "latin1");
    bmp.writeUInt32LE(bmp.length, 2);
    bmp.writeUInt32LE(54, 10); // where the pixels start
    bmp.writeUInt32LE(40, 14); // BITMAPINFOHEADER
    bmp.writeInt32LE(width, 18);
    bmp.writeInt32LE(height, 22); // positive: bottom-up
    bmp.writeUInt16LE(1, 26); // planes
    bmp.writeUInt16LE(24, 28); // bits a pixel
    bmp.writeUInt32LE(0, 30); // BI_RGB, uncompressed
    bmp.writeUInt32LE(imageSize, 34);
    bmp.writeInt32LE(2835, 38); // 72 dpi
    bmp.writeInt32LE(2835, 42);
    const byte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    for (let y = 0; y < height; y++) {
        const row = 54 + (height - 1 - y) * rowSize;
        for (let x = 0; x < width; x++) {
            const p = (y * width + x) * 3;
            bmp[row + x * 3] = byte(pixels[p + 2]);
            bmp[row + x * 3 + 1] = byte(pixels[p + 1]);
            bmp[row + x * 3 + 2] = byte(pixels[p]);
        }
    }
    return bmp;
}

/**
 * The installer's sidebar, as a 24-bit BMP, 164 × 314.
 * @param {Buffer} png - the app's icon, a PNG
 * @param {{ r: number, g: number, b: number }} colour - 0–255 a channel
 * @param {string} [name] - the icon's file, for the messages
 * @returns {Buffer}
 */
function sidebarBmp(png, colour, name) {
    return writeBmp(paint(readPng(png, name), colour), WIDTH, HEIGHT);
}

module.exports = { sidebarBmp, readPng, logoColour, writeBmp, WIDTH, HEIGHT };

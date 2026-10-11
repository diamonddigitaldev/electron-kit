"use strict";

// builder/sidebar.js, the installer's sidebar: the PNG reader (every row
// filter, and what it refuses), the colour taken from a logo, and the BMP.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { sidebarBmp, readPng, logoColour, writeBmp, WIDTH, HEIGHT } = require("../builder/sidebar");
const { encodePng } = require("./helpers/png");

/** A width × height image of every kind of neighbour: a gradient, noise from a fixed seed, and a see-through corner. */
function testImage(width, height) {
    const data = Buffer.alloc(width * height * 4);
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            data[i] = (x * 255) / (width - 1);
            data[i + 1] = (y * 255) / (height - 1);
            data[i + 2] = next();
            data[i + 3] = x < 3 && y < 3 ? 0 : 255 - next() % 64;
        }
    }
    return { width, height, data };
}

test("readPng() reads 8-bit RGBA with each of PNG's five row filters, and rows that mix them", () => {
    const image = testImage(13, 9);
    for (const filter of [0, 1, 2, 3, 4, (y) => y % 5]) {
        const read = readPng(encodePng(image, { filter }));
        assert.equal(read.width, 13);
        assert.equal(read.height, 9);
        assert.ok(read.data.equals(image.data), `filter ${filter}`);
    }
});

test("readPng() reads 8-bit RGB as opaque RGBA, with each filter", () => {
    const image = testImage(10, 6);
    const opaque = Buffer.from(image.data);
    for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
    for (const filter of [0, 1, 2, 3, 4]) {
        assert.ok(readPng(encodePng(image, { alpha: false, filter })).data.equals(opaque), `filter ${filter}`);
    }
});

test("readPng() reads the house's own icons: the demo's", () => {
    const icon = readPng(fs.readFileSync(path.join(__dirname, "..", "demo", "src", "assets", "icon.png")));
    assert.equal(icon.width, 512);
    assert.equal(icon.height, 512);
    // The middle is the logo's lighter diamond; the corner is see-through.
    assert.equal(icon.data[(256 * 512 + 256) * 4 + 3], 255);
    assert.equal(icon.data[3], 0);
});

test("readPng() refuses what it can't read, saying how to save it again", () => {
    const image = testImage(4, 4);
    const good = encodePng(image);
    const broken = Buffer.from(good);
    broken[44] ^= 0xff; // in IDAT's data
    const badFilter = (() => {
        const raw = Buffer.alloc(4 * 4 * 4 + 4);
        raw[0] = 5;
        const png = encodePng(image);
        // Rebuild IDAT with a row whose filter byte is 5.
        const ihdrEnd = 8 + 12 + 13;
        const body = zlib.deflateSync(raw);
        const chunk = Buffer.alloc(12 + body.length);
        chunk.writeUInt32BE(body.length, 0);
        chunk.write("IDAT", 4, "latin1");
        body.copy(chunk, 8);
        chunk.writeUInt32BE(zlib.crc32(body, zlib.crc32("IDAT")), 8 + body.length);
        return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(png.length - 12)]);
    })();
    const cases = [
        [Buffer.from("GIF89a"), /icon\.png isn't a PNG\./],
        [good.subarray(0, 30), /ends early: it's damaged/],
        [broken, /has a damaged IDAT chunk/],
        [badFilter, /has a row with filter 5/],
        [encodePng(image, { depth: 16 }), /has 16 bits a channel; the sidebar reads 8\. Save it again as an 8-bit RGBA PNG \(8 bits a channel, with alpha\) that isn't interlaced/],
        [encodePng(image, { colourType: 3 }), /is a palette \(indexed colour\) PNG; the sidebar reads RGB and RGBA\. Save it again/],
        [encodePng(image, { colourType: 0 }), /is a greyscale PNG/],
        [encodePng(image, { colourType: 4 }), /is a greyscale with alpha PNG/],
        [encodePng(image, { interlace: 1 }), /is interlaced; the sidebar reads PNGs that aren't\. Save it again/],
    ];
    for (const [png, error] of cases) {
        assert.throws(() => readPng(png, "icon.png"), error, String(error));
    }
});

test("logoColour(): the most common opaque colour, leaving out white, black, grey and see-through pixels", () => {
    const pixels = [];
    const add = (count, rgba) => {
        for (let i = 0; i < count; i++) pixels.push(...rgba);
    };
    add(500, [255, 255, 255, 255]); // white
    add(400, [0, 0, 0, 255]); // black
    add(300, [120, 120, 125, 255]); // grey
    add(250, [255, 0, 0, 100]); // see-through red
    add(100, [32, 134, 55, 255]); // green, in two near shades: one bucket
    add(100, [34, 136, 57, 255]);
    add(150, [13, 110, 253, 255]); // blue: more than either shade, fewer than both
    const image = { width: pixels.length / 4, height: 1, data: Buffer.from(pixels) };
    assert.deepEqual(logoColour(image), { r: 33, g: 135, b: 56 });
    assert.equal(logoColour({ width: 1, height: 1, data: Buffer.from([200, 200, 200, 255]) }), null);
});

test("the BMP: 24-bit, 164 × 314, rows bottom-up, each padded to 4 bytes", () => {
    const bmp = sidebarBmp(encodePng(testImage(40, 30)), { r: 32, g: 134, b: 55 });
    assert.equal(WIDTH, 164);
    assert.equal(HEIGHT, 314);
    assert.equal(bmp.toString("latin1", 0, 2), "BM");
    assert.equal(bmp.readUInt32LE(2), bmp.length);
    assert.equal(bmp.readUInt32LE(10), 54);
    assert.equal(bmp.readUInt32LE(14), 40);
    assert.equal(bmp.readInt32LE(18), 164);
    assert.equal(bmp.readInt32LE(22), 314, "positive: bottom-up");
    assert.equal(bmp.readUInt16LE(26), 1);
    assert.equal(bmp.readUInt16LE(28), 24);
    assert.equal(bmp.readUInt32LE(30), 0, "uncompressed");
    assert.equal(bmp.length, 54 + 164 * 3 * 314);

    // A width whose rows need padding, and which row comes first.
    const pixels = new Float64Array(3 * 2 * 3);
    pixels.set([1, 0, 0], 0); // top left: red
    const small = writeBmp(pixels, 3, 2);
    assert.equal(small.readUInt32LE(34), 12 * 2);
    assert.deepEqual([...small.subarray(54 + 12, 54 + 15)], [0, 0, 255], "the top row is last, blue-green-red");
    assert.deepEqual([...small.subarray(54 + 9, 54 + 12)], [0, 0, 0], "padding");
});

test("the sidebar: the same icon and colour make the same bytes, and a different colour different ones", () => {
    const png = encodePng(testImage(64, 64));
    const a = sidebarBmp(png, { r: 13, g: 110, b: 253 });
    assert.ok(a.equals(sidebarBmp(png, { r: 13, g: 110, b: 253 })));
    assert.ok(!a.equals(sidebarBmp(png, { r: 32, g: 134, b: 55 })));
    // A big icon is scaled down: the demo's 512 px one fits, leaving the background round it.
    const demo = sidebarBmp(fs.readFileSync(path.join(__dirname, "..", "demo", "src", "assets", "icon.png")), { r: 13, g: 110, b: 253 });
    assert.equal(demo.length, a.length);
});

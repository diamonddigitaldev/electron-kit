"use strict";

// kit.format, the house's wording for counts, sizes and times, from File
// Converter's core/display.js. page/kit.js is a page script, so it's run here
// in a context of its own with a stand-in window and document; the format
// helpers touch neither.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadKit() {
    const window = {};
    const document = { addEventListener() {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "page", "kit.js"), "utf8"), { window, document });
    return window.kit;
}

const { format } = loadKit();

test("@diamonddigitaldev/electron-kit/format is the page's kit.format under Node, frozen", () => {
    const node = require("../format");
    assert.deepEqual(Object.keys(node).sort(), Object.keys(format).sort());
    assert.equal(node.countOf(18000, "frame"), "18,000 frames");
    assert.equal(node.summarise({ done: 1 }, { one: "file", done: "converted" }), "1 file converted");
    assert.ok(Object.isFrozen(node));
    // The package exports it.
    assert.equal(require("../package.json").exports["./format"], "./format/index.js");
});

test("kit.format holds the house's helpers, and nothing else", () => {
    assert.deepEqual(Object.keys(format).sort(), ["countOf", "formatBytes", "formatDuration", "formatEta", "groupDigits", "plural", "summarise"]);
});

test("plural() and countOf() agree with the count, so '1 files' can't be written", () => {
    assert.equal(format.plural(1, "file"), "file");
    assert.equal(format.plural(0, "file"), "files");
    assert.equal(format.plural(3, "file"), "files");
    assert.equal(format.plural(1, "needs", "need"), "needs");
    assert.equal(format.plural(2, "needs", "need"), "need");
    assert.equal(format.countOf(1, "file"), "1 file");
    assert.equal(format.countOf(18000, "frame"), "18,000 frames");
    assert.equal(format.countOf(2, "more file"), "2 more files");
    assert.equal(format.countOf(1, "child", "children"), "1 child");
    assert.equal(format.countOf(4, "child", "children"), "4 children");
});

test("groupDigits() groups by thousands, keeps a sign, drops a fraction, and passes anything else through", () => {
    assert.equal(format.groupDigits(0), "0");
    assert.equal(format.groupDigits(999), "999");
    assert.equal(format.groupDigits(1000), "1,000");
    assert.equal(format.groupDigits(1234567), "1,234,567");
    assert.equal(format.groupDigits(-4500), "-4,500");
    assert.equal(format.groupDigits(1500.7), "1,500");
    assert.equal(format.groupDigits(NaN), "NaN");
    assert.equal(format.groupDigits("12"), "12");
});

test("formatBytes() is short, in binary units with one decimal below 10, and null when unknown", () => {
    assert.equal(format.formatBytes(0), "0 B");
    assert.equal(format.formatBytes(1023), "1023 B");
    assert.equal(format.formatBytes(1024), "1.0 KB");
    assert.equal(format.formatBytes(1536), "1.5 KB");
    assert.equal(format.formatBytes(10 * 1024), "10 KB");
    assert.equal(format.formatBytes(12.4 * 1024 * 1024), "12 MB");
    assert.equal(format.formatBytes(3 * 1024 ** 3), "3.0 GB");
    assert.equal(format.formatBytes(2048 * 1024 ** 4), "2048 TB");
    // Rounding up to 1024 of a unit is the next unit, never "1024 KB".
    assert.equal(format.formatBytes(1024 * 1024 - 1), "1.0 MB");
    for (const unknown of [null, undefined, -1, NaN, Infinity]) assert.equal(format.formatBytes(unknown), null);
});

test("formatEta() is terse, and null when unknown", () => {
    assert.equal(format.formatEta(0), "0s");
    assert.equal(format.formatEta(45.4), "45s");
    assert.equal(format.formatEta(59.6), "1m 00s");
    assert.equal(format.formatEta(125), "2m 05s");
    assert.equal(format.formatEta(3720), "1h 02m");
    for (const unknown of [null, undefined, -5, NaN]) assert.equal(format.formatEta(unknown), null);
});

test("formatDuration() is a clock, and null when unknown", () => {
    assert.equal(format.formatDuration(0), "0:00");
    assert.equal(format.formatDuration(545), "9:05");
    assert.equal(format.formatDuration(3723), "1:02:03");
    assert.equal(format.formatDuration(59.5), "1:00");
    for (const unknown of [null, undefined, -1, NaN]) assert.equal(format.formatDuration(unknown), null);
});

test("summarise() says how a batch went, in the app's words", () => {
    const words = { one: "file", done: "converted" };
    assert.equal(format.summarise({ done: 3, failed: 1, cancelled: 2 }, words), "3 files converted, 1 failed, 2 cancelled");
    assert.equal(format.summarise({ done: 1 }, words), "1 file converted");
    // The first count names the item, whichever it is.
    assert.equal(format.summarise({ failed: 1200 }, words), "1,200 files failed");
    assert.equal(format.summarise({ skipped: 5 }, words), "5 files skipped");
    assert.equal(format.summarise({ done: 2, skipped: 3 }, words), "2 files converted, 3 skipped");
    assert.equal(format.summarise({ done: 1, failed: 1, skipped: 1, cancelled: 2 }, words), "1 file converted, 1 failed, 1 skipped, 2 cancelled");
    assert.equal(format.summarise({ cancelled: 1 }, words), "1 file cancelled");
    assert.equal(format.summarise({}, words), "Nothing converted");
    assert.equal(format.summarise({ done: 2 }, { one: "clip", done: "joined" }), "2 clips joined");
    assert.throws(() => format.summarise({ done: 1 }), /words must name the item/);
});

"use strict";

// The contrast maths (testing/contrast.js): WCAG 2.2's relative luminance and
// contrast ratio, checked against known ratios, and the colour forms it reads.

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseColor, luminance, over, contrastRatio, toHex } = require("../testing/contrast");

/**
 * Known ratios, to two places: WCAG's ends, the classic smallest grey that
 * passes on white, Bootstrap 5.3's toast colours, and the apps' accents before
 * the kit (their brand colours on Bootstrap's surfaces).
 */
const KNOWN = [
    ["#000", "#fff", "21.00"],
    ["#fff", "#fff", "1.00"],
    ["#767676", "#fff", "4.54"],
    ["#000", "#0dcaf0", "10.72"], // info toast
    ["#fff", "#198754", "4.53"], // success toast
    ["#000", "#ffc107", "12.88"], // warning toast
    ["#fff", "#dc3545", "4.53"], // danger toast
    ["#fff", "#28a745", "3.13"], // white on File Converter's green
    ["#fff", "#34d058", "2.04"], // ... on its hover
    ["#28a745", "#f8f9fa", "2.97"], // its green as text on the light rail
    ["#28a745", "#fff", "3.13"],
    ["#28a745", "#212529", "4.92"],
    ["#5dd879", "#fff", "1.82"], // its muted link on white
    ["#9740fb", "#fff", "4.73"], // Media Player's purple
    ["#9740fb", "#212529", "3.26"],
    ["#9740fb", "#2b3035", "2.82"], // ... on the dark rail
    ["#c796ff", "#fff", "2.27"],
    ["#0d6efd", "#2b3035", "2.96"], // Bootstrap blue on the dark rail
    ["#6ea8fe", "#fff", "2.42"],
    ["#ffc107", "#f8f9fa", "1.55"], // a warning-yellow dot on the light rail
    ["#ffc107", "#2b3035", "8.17"],
];

test("contrast ratios match the known values", () => {
    for (const [fg, bg, expected] of KNOWN) {
        assert.equal(contrastRatio(fg, bg).toFixed(2), expected, `${fg} on ${bg}`);
    }
});

test("a contrast ratio is the same whichever colour is in front", () => {
    for (const [fg, bg] of KNOWN) assert.equal(contrastRatio(fg, bg), contrastRatio(bg, fg), `${fg} and ${bg}`);
});

test("relative luminance runs from 0 for black to 1 for white", () => {
    assert.equal(luminance("#000"), 0);
    assert.equal(luminance("#fff"), 1);
    // A channel at or under 0.04045 of full is linear: 10/255 is, 11/255 isn't.
    assert.equal(luminance({ r: 0, g: 10, b: 0 }), 0.7152 * (10 / 255 / 12.92));
    assert.equal(luminance({ r: 0, g: 11, b: 0 }), 0.7152 * ((11 / 255 + 0.055) / 1.055) ** 2.4);
});

test("parseColor() reads hex, rgb(), rgba() and a bare r, g, b", () => {
    const blue = { r: 13, g: 110, b: 253, a: 1 };
    assert.deepEqual(parseColor("#0d6efd"), blue);
    assert.deepEqual(parseColor("#0D6EFD"), blue);
    assert.deepEqual(parseColor("  13, 110, 253 "), blue);
    assert.deepEqual(parseColor("rgb(13, 110, 253)"), blue);
    assert.deepEqual(parseColor("rgb(13 110 253)"), blue);
    assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual(parseColor("rgba(40, 167, 69, .06)"), { r: 40, g: 167, b: 69, a: 0.06 });
    assert.deepEqual(parseColor("rgb(40 167 69 / 50%)"), { r: 40, g: 167, b: 69, a: 0.5 });
    assert.deepEqual(parseColor("#00000080"), { r: 0, g: 0, b: 0, a: 128 / 255 });
});

test("parseColor() refuses what it doesn't read", () => {
    for (const bad of ["red", "#12", "#12345", "rgb(256, 0, 0)", "hsl(0, 0%, 0%)", "13, 110", "rgba(0, 0, 0, 2)", "rgb(10%, 0, 0)", ""]) {
        assert.throws(() => parseColor(bad), /isn't a colour this helper reads/, JSON.stringify(bad));
    }
});

test("over() lays a see-through colour over an opaque one", () => {
    assert.deepEqual(over("rgba(0, 0, 0, 0.5)", "#fff"), { r: 127.5, g: 127.5, b: 127.5, a: 1 });
    assert.deepEqual(over("#0d6efd", "#fff"), { r: 13, g: 110, b: 253, a: 1 });
    // The active wash on the light rail: Bootstrap blue at 0.06 over #f8f9fa.
    assert.equal(toHex(over("rgba(13, 110, 253, 0.06)", "#f8f9fa")), "#eaf1fa");
    assert.throws(() => over("#000", "rgba(255, 255, 255, 0.5)"), /must be opaque/);
});

test("contrastRatio() lays a see-through foreground over its background first", () => {
    assert.equal(contrastRatio("rgba(0, 0, 0, 0.5)", "#fff"), contrastRatio({ r: 127.5, g: 127.5, b: 127.5 }, "#fff"));
    assert.throws(() => contrastRatio("#000", "rgba(0, 0, 0, 0.5)"), /must be opaque/);
});

test("toHex() writes an opaque colour as #rrggbb", () => {
    assert.equal(toHex("13, 110, 253"), "#0d6efd");
    assert.equal(toHex({ r: 127.5, g: 0, b: 255 }), "#8000ff");
});

"use strict";

// The card grid's selection rules (kit.ui.cardGrid.resolveSelection() and
// pruneSelection(), in page/kit.js), under Node: File Converter's own cases
// for the rules it had, ported as they were, then the kit's additions. The
// clicks, the keys and the bar are in e2e/card-grid.spec.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "page", "kit.js"), "utf8"), { window, document: { addEventListener() {} } });
const { resolveSelection, pruneSelection } = window.kit.ui.cardGrid;

const IDS = ["a", "b", "c", "d", "e"];

// -- File Converter's cases ------------------------------------------------------

test("selection: a plain click replaces the selection", () => {
    const r = resolveSelection(IDS, new Set(["a"]), "c", {}, "a");
    assert.deepEqual([...r.selection], ["c"]);
    assert.equal(r.anchor, "c");
});

test("selection: ctrl+click toggles", () => {
    const added = resolveSelection(IDS, new Set(["a"]), "c", { ctrl: true }, "a");
    assert.deepEqual([...added.selection].sort(), ["a", "c"]);

    const removed = resolveSelection(IDS, new Set(["a", "c"]), "c", { ctrl: true }, "a");
    assert.deepEqual([...removed.selection], ["a"]);
});

test("selection: shift+click selects a range in either direction", () => {
    const forward = resolveSelection(IDS, new Set(["b"]), "d", { shift: true }, "b");
    assert.deepEqual([...forward.selection], ["b", "c", "d"]);

    const backward = resolveSelection(IDS, new Set(["d"]), "b", { shift: true }, "d");
    assert.deepEqual([...backward.selection], ["b", "c", "d"]);

    assert.equal(forward.anchor, "b", "the anchor survives a shift range");
});

test("selection: ctrl+shift extends rather than replacing", () => {
    const r = resolveSelection(IDS, new Set(["e"]), "c", { ctrl: true, shift: true }, "b");
    assert.deepEqual([...r.selection].sort(), ["b", "c", "e"]);
});

test("selection: clicking inside a multi-selection keeps it", () => {
    // Otherwise acting on a group would collapse it to one card first.
    const r = resolveSelection(IDS, new Set(["a", "b", "c"]), "b", {}, "a");
    assert.deepEqual([...r.selection].sort(), ["a", "b", "c"]);
    assert.equal(r.anchor, "b");
});

test("selection: clicking outside a multi-selection replaces it", () => {
    const r = resolveSelection(IDS, new Set(["a", "b"]), "e", {}, "a");
    assert.deepEqual([...r.selection], ["e"]);
});

test("selection: a stale anchor degrades to a plain click", () => {
    const r = resolveSelection(IDS, new Set(), "c", { shift: true }, "zzz");
    assert.deepEqual([...r.selection], ["c"]);
});

test("selection: removals cannot strand ids", () => {
    const pruned = pruneSelection(new Set(["a", "gone", "c"]), IDS);
    assert.deepEqual([...pruned].sort(), ["a", "c"]);
});

// -- The kit's additions ---------------------------------------------------------

test("selection: a shift click with no anchor at all, or modifiers left out, is a plain click", () => {
    assert.deepEqual([...resolveSelection(IDS, new Set(["a", "b"]), "d", { shift: true }, null).selection], ["d"]);
    assert.deepEqual([...resolveSelection(IDS, new Set(["a"]), "d").selection], ["d"]);
});

test("selection: a plain click on the one card selected keeps it, and a ctrl click on it empties the selection", () => {
    assert.deepEqual([...resolveSelection(IDS, new Set(["c"]), "c", {}, "c").selection], ["c"]);
    const r = resolveSelection(IDS, new Set(["c"]), "c", { ctrl: true }, "c");
    assert.deepEqual([...r.selection], []);
    assert.equal(r.anchor, "c");
});

test("selection: a shift click on the anchor itself selects just it", () => {
    assert.deepEqual([...resolveSelection(IDS, new Set(["a", "e"]), "c", { shift: true }, "c").selection], ["c"]);
});

test("selection: the rules take any items, such as a grid's cards, and never change the selection they're given", () => {
    const cards = IDS.map((id) => ({ id }));
    const current = new Set([cards[0]]);
    const r = resolveSelection(cards, current, cards[2], { shift: true }, cards[0]);
    assert.deepEqual([...r.selection].map((card) => card.id), ["a", "b", "c"]);
    assert.equal(r.anchor, cards[0]);
    assert.deepEqual([...current].map((card) => card.id), ["a"]);
    const pruned = pruneSelection(r.selection, [cards[0], cards[2]]);
    assert.deepEqual([...pruned].map((card) => card.id), ["a", "c"]);
});

"use strict";

// kit.format under Node: the same helpers as the page library's (page/kit.js),
// for a file that's loaded both in the page and under Node, as File
// Converter's core/display.js is, so the house's wording has one
// implementation:
//
//     const format = require("@diamonddigitaldev/electron-kit/format");
//     format.countOf(3, "file");   // "3 files"
//
// It runs page/kit.js itself, in a context of its own with a stand-in window
// and document (the format helpers touch neither), and hands back its
// kit.format, frozen.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "page", "kit.js"), "utf8"), {
    window,
    document: { addEventListener() {} },
}, { filename: path.join(__dirname, "..", "page", "kit.js") });

module.exports = Object.freeze({ ...window.kit.format });

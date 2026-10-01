"use strict";

// The README, which npm shows, is short and links to the docs in the
// repository, so a correction to them needs no release. npm only shows the
// README a version was published with, so it links to the docs' contents
// alone, absolute and on master, and never to a page, which could be renamed
// or split after a release; docs/README.md lists the pages instead. Every
// relative link between the docs must reach a file in the repository, and the
// contents must list every page.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const BLOB = "https://github.com/diamonddigitaldev/electron-kit/blob/master/";

/** Every Markdown link's target in a file, outside code blocks. */
function linkTargets(file) {
    const text = fs.readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
}

const pages = fs.readdirSync(DOCS).filter((name) => name.endsWith(".md"));

test("the README links into docs/ only at its contents, absolute and on master", () => {
    const targets = linkTargets(path.join(ROOT, "README.md"));
    const intoDocs = targets.filter((target) => target.includes("docs/"));
    assert.deepEqual(intoDocs, [`${BLOB}docs/README.md`], "the README must link to the docs' contents, and to no page of them");
    assert.ok(fs.existsSync(path.join(DOCS, "README.md")), "docs/README.md isn't there");
});

test("every relative link in docs/ reaches a file in the repository", () => {
    for (const page of pages) {
        for (const target of linkTargets(path.join(DOCS, page))) {
            if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
            const file = path.resolve(DOCS, target.split("#")[0]);
            assert.ok(fs.existsSync(file), `docs/${page} links to ${target}, which isn't there`);
        }
    }
});

test("docs/README.md lists every page of the docs", () => {
    const listed = linkTargets(path.join(DOCS, "README.md"));
    for (const page of pages.filter((name) => name !== "README.md")) {
        assert.ok(listed.includes(page), `docs/README.md doesn't list ${page}`);
    }
});

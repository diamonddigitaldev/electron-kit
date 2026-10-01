"use strict";

// The README, which npm shows, is short and links to the docs in the
// repository, so a correction to them needs no release. Its links into docs/
// must be absolute, on master, and name a page that's there; every relative
// link between the docs must reach a file in the repository; and the docs'
// own README must list every page.

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

test("the README links into docs/ by absolute links on master, each naming a page that's there", () => {
    const targets = linkTargets(path.join(ROOT, "README.md"));
    const intoDocs = targets.filter((target) => target.includes("/docs/") || target.startsWith("docs/"));
    assert.ok(intoDocs.length >= pages.length, `the README links to ${intoDocs.length} pages of docs/, which has ${pages.length}`);
    for (const target of intoDocs) {
        assert.ok(target.startsWith(`${BLOB}docs/`), `${target} must be absolute, on master (${BLOB}docs/…)`);
        const file = path.join(ROOT, target.slice(BLOB.length).split("#")[0]);
        assert.ok(fs.existsSync(file), `${target} names ${path.relative(ROOT, file)}, which isn't there`);
    }
    for (const page of pages) {
        assert.ok(intoDocs.some((target) => target === `${BLOB}docs/${page}`), `the README doesn't link to docs/${page}`);
    }
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

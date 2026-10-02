"use strict";

// The ddd-electron-ui skill the package ships (skill/), and the command that
// copies it into an app (bin/electron-kit.js): the skill names only what the
// kit has, and the docs pages it points to exist; the command copies it, and
// --check tells a copy that's out of date.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { main, skill, SKILL, SOURCE } = require("../bin/electron-kit");
const kitPackage = require("../package.json");
const testing = require("../testing");

const ROOT = path.join(__dirname, "..");
const TEXT = fs.readFileSync(path.join(SOURCE, "SKILL.md"), "utf8");

/** A folder of its own for a test, deleted after it. */
function withDir(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-skill-"));
    try {
        return run(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** The command's output, and its exit code. */
function run(args, io = {}) {
    const lines = [];
    const code = main(args, { out: (line) => lines.push(line), ...io });
    return { code, text: lines.join("\n") };
}

test("the package ships the skill and the command, as electron-kit", () => {
    assert.ok(kitPackage.files.includes("skill/"));
    assert.ok(kitPackage.files.includes("bin/"));
    assert.deepEqual(kitPackage.bin, { "electron-kit": "bin/electron-kit.js" });
    assert.match(fs.readFileSync(path.join(ROOT, "bin", "electron-kit.js"), "utf8"), /^#!\/usr\/bin\/env node\n/, "a shebang, ending in LF");
    assert.ok(!TEXT.includes("\r"), "the skill's lines end in LF, so every copy is the same bytes");
});

test("the skill is ddd-electron-ui, with a description, and points at the docs on master", () => {
    const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(TEXT);
    assert.ok(front, "front matter with a name and a description");
    assert.equal(front[1], SKILL);
    assert.ok(front[2].length > 200 && front[2].length < 1024, "a description a session can match on");
    assert.ok(TEXT.includes("https://github.com/diamonddigitaldev/electron-kit/blob/master/docs/README.md"));
});

test("every docs page the skill names is one in docs/README.md", () => {
    const contents = fs.readFileSync(path.join(ROOT, "docs", "README.md"), "utf8");
    const pages = new Set([...contents.matchAll(/^\| \[([^\]]+)\]\([^)]+\.md\) \|/gm)].map((m) => m[1]));
    const named = new Set();
    for (const row of TEXT.matchAll(/^\|.*\| ([^|]+) \|$/gm)) {
        for (const page of row[1].split(";").map((s) => s.trim())) if (page !== "Docs page") named.add(page);
    }
    assert.ok(named.size >= 8);
    for (const page of named) assert.ok(pages.has(page), `"${page}" isn't a page in docs/README.md`);
});

test("every kit call the skill names is one the kit has", () => {
    const kitJs = fs.readFileSync(path.join(ROOT, "page", "kit.js"), "utf8");
    const index = fs.readFileSync(path.join(ROOT, "main", "index.js"), "utf8");
    for (const [, area, name] of TEXT.matchAll(/kit\.(ui|keys|format)\.(\w+)\(/g)) {
        assert.match(kitJs, new RegExp(`\\b${name}\\b`), `kit.${area}.${name}()`);
    }
    for (const [, area, name] of TEXT.matchAll(/kit\.(windows|sessions|ipc|files|log)\.(\w+)\(/g)) {
        assert.match(index, new RegExp(`${area}: \\{[^}]*\\b${name}\\b`), `kit.${area}.${name}() in start()'s return`);
    }
    for (const [, name] of TEXT.matchAll(/`(assert\w+|loadPreload|netLogSwitches)\(/g)) {
        assert.equal(typeof testing[name], "function", `electron-kit/testing's ${name}()`);
    }
});

test("skill copies the skill into the app's .claude/skills/, replacing an older copy", () => withDir((app) => {
    fs.writeFileSync(path.join(app, "package.json"), "{}");
    const target = path.join(app, ".claude", "skills", SKILL);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "old-notes.md"), "an earlier version's file");

    const copied = run(["skill"], { cwd: app });
    assert.equal(copied.code, 0, copied.text);
    assert.equal(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), TEXT);
    assert.equal(fs.existsSync(path.join(target, "old-notes.md")), false);
    assert.equal(run(["skill", "--check"], { cwd: app }).code, 0);
}));

test("skill --check fails on a copy that's missing, changed or has a file of its own, and copies nothing", () => withDir((app) => {
    fs.writeFileSync(path.join(app, "package.json"), "{}");
    const target = path.join(app, ".claude", "skills", SKILL);
    let checked = run(["skill", "--check", "--dir", app]);
    assert.equal(checked.code, 1);
    assert.match(checked.text, /SKILL\.md is missing/);
    assert.equal(fs.existsSync(target), false, "nothing copied");

    run(["skill", "--dir", app]);
    fs.appendFileSync(path.join(target, "SKILL.md"), "\nA rule added by hand.\n");
    fs.writeFileSync(path.join(target, "extra.md"), "x");
    checked = run(["skill", "--check", "--dir", app]);
    assert.equal(checked.code, 1);
    assert.match(checked.text, /SKILL\.md differs/);
    assert.match(checked.text, /extra\.md isn't the kit's/);
    assert.match(checked.text, /Run: npx @diamonddigitaldev\/electron-kit skill/);
}));

test("skill --user writes the user's own skills folder", () => withDir((home) => {
    assert.equal(skill(["--user"], { out: () => {}, home, cwd: os.tmpdir() }), 0);
    assert.equal(fs.readFileSync(path.join(home, ".claude", "skills", SKILL, "SKILL.md"), "utf8"), TEXT);
    assert.equal(skill(["--user", "--check"], { out: () => {}, home, cwd: os.tmpdir() }), 0);
}));

test("the command refuses a folder that isn't an app, an unknown option or command, and says how it's used", () => withDir((dir) => {
    assert.equal(run(["skill"], { cwd: dir }).code, 2);
    assert.match(run(["skill"], { cwd: dir }).text, /has no package\.json/);
    assert.equal(run(["skill", "--force"], { cwd: dir }).code, 2);
    assert.equal(run(["skill", "--user", "--dir", "x"], { cwd: dir }).code, 2);
    assert.equal(run(["create"]).code, 2);
    assert.match(run(["create"]).text, /Unknown command: create/);
    assert.equal(run([]).code, 2);
    const help = run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.text, /npx @diamonddigitaldev\/electron-kit <command>/);
}));

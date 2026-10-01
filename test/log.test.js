"use strict";

// The log (main/log.js): four levels, LOG_LEVEL, a banner per launch, the
// file in userData emptied at each launch, and everything redacted before
// it's written (D67): a path keeps its file name only, a URL its scheme, host
// and path.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLog, checkLog, redact, LEVELS, LOG_FILE } = require("../main/log");
const { loadMain } = require("./helpers/main");

/** A console that records each line, by what it was written with. */
function recordingConsole() {
    const lines = [];
    return { lines, error: (m) => lines.push(["error", m]), warn: (m) => lines.push(["warn", m]), log: (m) => lines.push(["log", m]) };
}

/** A clock that ticks a second a call, from a fixed time. */
function clock() {
    let t = Date.parse("2026-10-01T09:00:00.000Z");
    return () => new Date((t += 1000) - 1000);
}

// -- Redaction ---------------------------------------------------------------------

test("a Windows path keeps its file name only, spaces and all, wherever it is in the line", () => {
    assert.equal(redact(String.raw`Could not probe C:\Users\will\My Videos\b c.wav: no stream`), String.raw`Could not probe …\b c.wav: no stream`);
    assert.equal(redact("Conversion failed for D:/media/x/clip.mp4: exit 1"), "Conversion failed for …/clip.mp4: exit 1");
    assert.equal(redact(String.raw`two C:\a\one.mp4 C:\b\two.mp4`), String.raw`two …\one.mp4 …\two.mp4`);
    assert.equal(redact(String.raw`\\nas\share\will\a.mp4: gone`), String.raw`…\a.mp4: gone`);
    assert.equal(redact("C:\\Users\\will\\"), "…\\");
});

test("argv logged as JSON keeps each file's name, and a stack keeps its file and line", () => {
    const argv = JSON.stringify([String.raw`C:\Program Files\DFC\dfc.exe`, String.raw`C:\Users\will\a.mp4`, "--flag"]);
    assert.equal(redact(`argv: ${argv}`), String.raw`argv: ["…\\dfc.exe","…\\a.mp4","--flag"]`);
    const stack = "Error: boom\n    at run (C:\\Program Files\\DFC\\resources\\app.asar\\src\\main.js:10:5)";
    assert.equal(redact(stack), "Error: boom\n    at run (…\\main.js:10:5)");
});

test("a POSIX path, from the root or home, keeps its file name only; a fraction or 'and/or' isn't a path", () => {
    assert.equal(redact("opened /home/will/Videos/a b.mp4 and ~/x/y.txt"), "opened …/a b.mp4 and …/y.txt");
    assert.equal(redact("see (/usr/lib/x.so)"), "see (…/x.so)");
    assert.equal(redact("/home/will/a.mp4"), "…/a.mp4");
    const plain = "ratio 3/4, and/or plain words, version 2.0.0, at 12:30, 50% done";
    assert.equal(redact(plain), plain);
});

test("a URL keeps its scheme, host and path, and loses its query, fragment and user name", () => {
    assert.equal(redact("share https://drop.example.com/d/abc123?x=1#key=SECRET done"), "share https://drop.example.com/d/abc123 done");
    assert.equal(redact("http://user:pw@host:8080/a"), "http://host:8080/a");
    assert.equal(redact("from https://github.com/diamonddigitaldev/x/releases"), "from https://github.com/diamonddigitaldev/x/releases");
    // A file: URL is a path: its file name only.
    assert.equal(redact("file:///C:/Users/will/a%20b.mp4 loaded"), "file://…/a b.mp4 loaded");
    assert.equal(redact("file:///home/will/x/page.html#top"), "file://…/page.html");
});

// -- The log -------------------------------------------------------------------------

test("checkLog(): \"file\", { mode: \"file\" } or nothing; anything else throws", () => {
    assert.deepEqual(checkLog(undefined), { mode: null });
    assert.deepEqual(checkLog("file"), { mode: "file" });
    assert.deepEqual(checkLog({ mode: "file" }), { mode: "file" });
    for (const bad of ["memory", true, {}, "debug.log"]) {
        assert.throws(() => checkLog(bad), /log must be "file"/);
    }
});

test("the file is debug.log in its folder, emptied with a banner at each launch, and each line timed, levelled and redacted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-log-"));
    try {
        fs.writeFileSync(path.join(dir, LOG_FILE), "yesterday's run\n");
        const out = recordingConsole();
        const log = createLog({ mode: "file", dir, level: "INFO", banner: "Kit Demo 1.2.3 started", now: clock(), console: out });
        assert.equal(log.file, path.join(dir, "debug.log"));
        log.info("Opened", String.raw`C:\Users\will\a.mp4`);
        log.warn("Could not probe", { path: "/home/will/b.wav", code: 1 });
        const failure = new Error(String.raw`ENOENT: C:\Users\will\gone.mp4`);
        log.error(failure);
        log.debug("not kept at INFO");
        assert.equal(fs.readFileSync(log.file, "utf8"), [
            "=== Kit Demo 1.2.3 started at 2026-10-01T09:00:00.000Z ===",
            String.raw`[2026-10-01T09:00:01.000Z] [INFO] Opened …\a.mp4`,
            '[2026-10-01T09:00:02.000Z] [WARN] Could not probe {"path":"…/b.wav","code":1}',
            `[2026-10-01T09:00:03.000Z] [ERROR] ${redact(failure.stack)}`,
            "",
        ].join("\n"));
        assert.ok(!fs.readFileSync(log.file, "utf8").includes("will"), "no folder is written");
        // Mirrored to the console, redacted too, by level.
        assert.deepEqual(out.lines.map(([how]) => how), ["log", "warn", "error"]);
        assert.equal(out.lines[0][1], String.raw`Opened …\a.mp4`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("LOG_LEVEL sets the least kept, in any case; anything else is INFO", () => {
    const kept = (level) => {
        const out = recordingConsole();
        const log = createLog({ level, console: out });
        for (const name of ["error", "warn", "info", "debug"]) log[name](name);
        return [log.level, out.lines.map(([, m]) => m).join(",")];
    };
    assert.deepEqual(kept("DEBUG"), ["DEBUG", "error,warn,info,debug"]);
    assert.deepEqual(kept("warn"), ["WARN", "error,warn"]);
    assert.deepEqual(kept("ERROR"), ["ERROR", "error"]);
    assert.deepEqual(kept(undefined), ["INFO", "error,warn,info"]);
    assert.deepEqual(kept("LOUD"), ["INFO", "error,warn,info"]);
    assert.deepEqual(Object.keys(LEVELS), ["ERROR", "WARN", "INFO", "DEBUG"]);
});

test("without a file, the log is the console's only; a file that can't be written stops being tried, and the app goes on", () => {
    const out = recordingConsole();
    assert.equal(createLog({ console: out }).file, null);

    const writes = [];
    const broken = {
        writeFileSync: (file) => {
            writes.push(file);
            throw new Error(String.raw`EACCES: C:\Users\will\AppData\debug.log`);
        },
        appendFileSync: (file) => writes.push(file),
    };
    const failing = recordingConsole();
    const log = createLog({ mode: "file", dir: "/somewhere", fileSystem: broken, console: failing });
    log.info("still logged");
    assert.equal(writes.length, 1, "nothing appended after the first write failed");
    assert.deepEqual(failing.lines, [["error", String.raw`The log can't be written: EACCES: …\debug.log`], ["log", "still logged"]]);
});

test("kit.start({ log: \"file\" }) writes debug.log in userData, with the app's name and version, and hands main the log", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-log-"));
    try {
        const { main } = loadMain({ userData: dir, version: "2.0.0" });
        const kit = main.start({ name: "Diamond File Converter", log: "file" });
        kit.log.info("Opened", "/home/will/a.mp4");
        const text = fs.readFileSync(path.join(dir, "debug.log"), "utf8");
        assert.match(text, /^=== Diamond File Converter 2\.0\.0 started at \S+ ===\n\[\S+\] \[INFO\] Opened …\/a\.mp4\n$/);
        assert.deepEqual(Object.keys(kit.log), ["error", "warn", "info", "debug"]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("kit.start() without log writes no file, and a bad log option throws before anything is registered", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-log-"));
    try {
        const { main } = loadMain({ userData: dir });
        main.start({});
        assert.deepEqual(fs.readdirSync(dir), []);
        const second = loadMain({ userData: dir });
        assert.throws(() => second.main.start({ log: "memory" }), /log must be "file"/);
        assert.equal(second.handlers.size, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

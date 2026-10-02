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
const { createLog, checkLog, redact, LEVELS, LOG_FILE, MEMORY_LINES } = require("../main/log");
const { loadMain, appPage } = require("./helpers/main");

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

test("checkLog(): \"file\" or \"memory\", as a string or { mode }, or nothing; anything else throws", () => {
    assert.deepEqual(checkLog(undefined), { mode: null, lines: 1000 });
    assert.deepEqual(checkLog("file"), { mode: "file", lines: 1000 });
    assert.deepEqual(checkLog({ mode: "file" }), { mode: "file", lines: 1000 });
    assert.deepEqual(checkLog("memory"), { mode: "memory", lines: 1000 });
    assert.deepEqual(checkLog({ mode: "memory", lines: 250 }), { mode: "memory", lines: 250 });
    for (const bad of ["ring", true, {}, "debug.log"]) {
        assert.throws(() => checkLog(bad), /log must be "file" .* or "memory"/);
    }
    for (const lines of [MEMORY_LINES.min - 1, MEMORY_LINES.max + 1, 10.5, "500"]) {
        assert.throws(() => checkLog({ mode: "memory", lines }), /log\.lines must be a whole number from 100 to 100000/);
    }
    assert.throws(() => checkLog({ mode: "file", lines: 500 }), /log\.lines is for the memory log only/);
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

test("without a file, the log is the console's only; a write that fails is said once, and the next line tries again", () => {
    const out = recordingConsole();
    assert.equal(createLog({ console: out }).file, null);

    const writes = [];
    let held = true;
    // A file held for a moment, as a virus scanner on Windows holds one.
    const sometimesHeld = {
        writeFileSync: (_file, text) => writes.push(text),
        appendFileSync: (_file, text) => {
            if (held) throw new Error(String.raw`EBUSY: C:\Users\will\AppData\debug.log`);
            writes.push(text);
        },
    };
    const failing = recordingConsole();
    const log = createLog({ mode: "file", dir: "/somewhere", fileSystem: sometimesHeld, console: failing, now: clock() });
    log.info("lost");
    log.info("lost too");
    held = false;
    log.info("written");
    assert.deepEqual(writes, ["=== App started at 2026-10-01T09:00:00.000Z ===\n", "[2026-10-01T09:00:03.000Z] [INFO] written\n"]);
    assert.deepEqual(failing.lines, [
        ["error", String.raw`The log can't be written: EBUSY: …\debug.log`],
        ["log", "lost"], ["log", "lost too"], ["log", "written"],
    ]);
});

test("kit.start({ log: \"file\" }) writes debug.log in userData, with the app's name and version, and hands main the log", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-log-"));
    try {
        const { main } = loadMain({ userData: dir, version: "2.0.0" });
        const kit = main.start({ name: "Diamond File Converter", log: "file" });
        kit.log.info("Opened", "/home/will/a.mp4");
        const text = fs.readFileSync(path.join(dir, "debug.log"), "utf8");
        assert.match(text, /^=== Diamond File Converter 2\.0\.0 started at \S+ ===\n\[\S+\] \[INFO\] Opened …\/a\.mp4\n$/);
        assert.deepEqual(Object.keys(kit.log), ["error", "warn", "info", "debug", "lines"]);
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
        assert.throws(() => second.main.start({ log: "ring" }), /log must be "file"/);
        assert.equal(second.handlers.size, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// -- The memory log (D97) ---------------------------------------------------------

/** A folder of its own for a test, deleted after it. */
async function withDir(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-log-"));
    try {
        return await run(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** Ask a channel's handler as the app's own page would. */
const ask = ({ handlers, eventFrom }, channel, ...args) => handlers.get(channel)(eventFrom(appPage()), ...args);

test("the memory log keeps the banner and the run's last lines, redacted, and writes nothing until it's told", () => withDir((dir) => {
    const out = recordingConsole();
    const log = createLog({ mode: "memory", dir, lines: 3, banner: "Dropgate 4.0.0 started", now: clock(), console: out });
    for (const n of [1, 2, 3, 4]) log.info(`line ${n}`, String.raw`C:\Users\will\file${n}.txt`);
    assert.deepEqual(log.lines(), [
        "=== Dropgate 4.0.0 started at 2026-10-01T09:00:00.000Z ===",
        String.raw`[2026-10-01T09:00:02.000Z] [INFO] line 2 …\file2.txt`,
        String.raw`[2026-10-01T09:00:03.000Z] [INFO] line 3 …\file3.txt`,
        String.raw`[2026-10-01T09:00:04.000Z] [INFO] line 4 …\file4.txt`,
    ]);
    assert.equal(log.file, path.join(dir, LOG_FILE));
    assert.equal(log.onDisk(), false);
    assert.deepEqual(fs.readdirSync(dir), [], "nothing on disk");
    assert.equal(out.lines.length, 4, "still mirrored to the console");
    // The list handed out is a copy.
    log.lines().push("not kept");
    assert.equal(log.lines().length, 4);
}));

test("kept on disk, the run so far is written and each line after it added; not kept, the file is deleted", () => withDir((dir) => {
    const log = createLog({ mode: "memory", dir, now: clock(), console: recordingConsole() });
    log.info("before");
    log.keepOnDisk(true);
    log.info("after", "https://drop.example.com/d/1#key");
    assert.equal(log.onDisk(), true);
    assert.equal(fs.readFileSync(log.file, "utf8"), [
        "=== App started at 2026-10-01T09:00:00.000Z ===",
        "[2026-10-01T09:00:01.000Z] [INFO] before",
        "[2026-10-01T09:00:02.000Z] [INFO] after https://drop.example.com/d/1",
        "",
    ].join("\n"));
    log.keepOnDisk(true); // Again: nothing rewritten.
    log.keepOnDisk(false);
    assert.equal(log.onDisk(), false);
    assert.deepEqual(fs.readdirSync(dir), []);
    log.info("not written");
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.equal(log.lines().at(-1), "[2026-10-01T09:00:03.000Z] [INFO] not written");
    assert.throws(() => log.keepOnDisk("yes"), /takes true or false/);
}));

test("the first keepOnDisk(false) deletes a file an earlier run kept; only the memory log takes it", () => withDir((dir) => {
    fs.writeFileSync(path.join(dir, LOG_FILE), "an earlier run, kept on disk\n");
    const log = createLog({ mode: "memory", dir, console: recordingConsole() });
    log.keepOnDisk(false);
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.throws(() => createLog({ mode: "file", dir, console: recordingConsole() }).keepOnDisk(false), /Only the memory log/);
    assert.throws(() => createLog({ console: recordingConsole() }).keepOnDisk(true), /Only the memory log/);
}));

test("a file log and the console's keep the last lines too", () => {
    const log = createLog({ console: recordingConsole(), now: clock() });
    log.warn("kept");
    assert.deepEqual(log.lines(), ["=== App started at 2026-10-01T09:00:00.000Z ===", "[2026-10-01T09:00:01.000Z] [WARN] kept"]);
});

test("kit.start({ log: \"memory\" }) adds keepLogOnDisk, off: no file, an earlier one deleted, and the setting turns it on and off", () => withDir(async (dir) => {
    fs.writeFileSync(path.join(dir, LOG_FILE), "an earlier run's\n");
    const loaded = loadMain({ userData: dir, version: "4.0.0", name: "Dropgate" });
    const kit = loaded.main.start({ log: "memory" });
    kit.log.info("Opened", "/home/will/a.txt");
    await kit.ready;
    assert.deepEqual(fs.readdirSync(dir), [], "the earlier run's file is deleted");
    assert.equal((await ask(loaded, "settings:get")).keepLogOnDisk, false);

    await ask(loaded, "settings:set", { keepLogOnDisk: true });
    kit.log.warn("now on disk");
    const text = fs.readFileSync(path.join(dir, LOG_FILE), "utf8");
    assert.match(text, /^=== Dropgate 4\.0\.0 started at \S+ ===\n\[\S+\] \[INFO\] Opened …\/a\.txt\n\[\S+\] \[WARN\] now on disk\n$/);
    assert.equal(kit.log.lines().length, 3);

    await ask(loaded, "settings:set", { keepLogOnDisk: false });
    assert.deepEqual(fs.readdirSync(dir), []);
}));

test("kit.start({ log: \"memory\" }) with keepLogOnDisk saved on writes the run from launch; other logs have no such setting", () => withDir(async (dir) => {
    const { main } = loadMain({ userData: dir, stored: { settings: { keepLogOnDisk: true } } });
    const kit = main.start({ log: { mode: "memory", lines: 100 } });
    kit.log.info("early");
    await kit.ready;
    assert.match(fs.readFileSync(path.join(dir, LOG_FILE), "utf8"), /\[INFO\] early\n$/);

    const fileKit = loadMain({ userData: dir }).main.start({ log: "file" });
    assert.equal(Object.hasOwn(fileKit.settings.get(), "keepLogOnDisk"), false);
    assert.throws(() => fileKit.settings.set({ keepLogOnDisk: true }), /no setting called "keepLogOnDisk"/);
    assert.throws(() => loadMain({ userData: dir }).main.start({ settings: { defaults: { keepLogOnDisk: false } } }), /one of the kit's own settings/);
}));

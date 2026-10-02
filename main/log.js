"use strict";

// The app's log, as File Converter keeps it: four levels (ERROR, WARN, INFO,
// DEBUG), the least kept set by the LOG_LEVEL environment variable (INFO if
// it's not set), each line timed and levelled, and mirrored to the console.
//
// kit.start({ log: "file" }) writes it to debug.log in the app's userData
// folder, emptied at each launch and started with a banner, so the file is
// one run's. A write that fails is said on the console, and the next line
// tries again. Without the option, the log goes to the console only.
//
// kit.start({ log: "memory" }) keeps it in memory only: the run's last lines
// (1000, or { mode: "memory", lines }), behind its banner, with nothing on
// disk unless the person keeps it there (the kit's keepLogOnDisk setting, off
// by default: D97). Kept on disk, the run so far is written to debug.log and
// each line after it is added; not kept, debug.log is deleted. Every mode
// keeps the last lines, which kit.log.lines() hands out, so an app can copy or
// save them.
//
// Everything is redacted before it's written anywhere (Dropgate's hard
// requirement 8; D67): a path keeps its file name only (C:\Users\will\clip.mp4
// is …\clip.mp4), and a URL loses its query, its fragment and any user name
// or password (a Dropgate link's key is in its fragment). So an app can log a
// file it failed on, or the argv it was opened with, without the log saying
// where a person keeps their files.

const fs = require("fs");
const path = require("path");

/** The levels, most serious first. A message is kept if its level is at or above the one set. */
const LEVELS = Object.freeze({ ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 });

/** The log file's name, in userData. */
const LOG_FILE = "debug.log";

/** How many of the run's lines are kept in memory, unless the app says otherwise, and the fewest and most it may. */
const MEMORY_LINES = Object.freeze({ default: 1000, min: 100, max: 100000 });

// -- Redaction -------------------------------------------------------------------

/** A URL: its scheme, then anything up to a space or a quote. */
const URL_PATTERN = /\b([a-z][a-z0-9+.-]*):\/\/[^\s"'<>`]+/gi;

/**
 * A path: a Windows drive's (C:\…), a share's (\\server\…), or one from a
 * POSIX root or home (/…/…, ~/…). It runs on, spaces and all, until
 * something no file name holds on Windows (a colon, a quote, <, >, |, ?, *),
 * the line ends, or another path starts, so it may take some of the words
 * after it too; only what follows its last separator is kept, so a folder is
 * never left behind.
 */
const PATH_START = String.raw`(?:(?<![\w\\])[A-Za-z]:[\\/]|(?<![\w\\])\\\\[^\\/\s:*?"<>|]+[\\/]|(?<=^|[\s(\[='"])~?\/(?=[^\s/:*?"<>|]+\/))`;
const PATH_PATTERN = new RegExp(String.raw`${PATH_START}(?:(?!\s+${PATH_START})[^:*?"<>|\r\n])*`, "g");

/**
 * A path's file name, after the last separator, with an ellipsis and the
 * separator it had before it: doubled if it was, as in a path inside JSON, so
 * the JSON stays JSON.
 */
function fileNameOf(found) {
    const cut = Math.max(found.lastIndexOf("\\"), found.lastIndexOf("/"));
    const separator = found[cut] === "\\" && found[cut - 1] === "\\" ? "\\\\" : found[cut];
    return `…${separator}${found.slice(cut + 1)}`;
}

/** A URL as it's logged: scheme, host and path, without a user name, query or fragment; a file: URL's file name only. */
function redactUrl(found) {
    let url;
    try {
        url = new URL(found);
    } catch {
        return "<url>";
    }
    if (url.protocol === "file:") {
        const name = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        return `file://…/${name}`;
    }
    // A URL without a host keeps its scheme alone.
    return url.host ? `${url.protocol}//${url.host}${url.pathname}` : `${url.protocol}…`;
}

/**
 * A line with every path cut to its file name and every URL to its scheme,
 * host and path.
 * @param {string} text
 */
function redact(text) {
    // URLs first, set aside, so their paths aren't taken for files.
    const urls = [];
    const held = String(text).replace(URL_PATTERN, (found) => {
        urls.push(redactUrl(found));
        return `\u0000${urls.length - 1}\u0000`;
    });
    return held
        .replace(PATH_PATTERN, fileNameOf)
        .replace(/\u0000(\d+)\u0000/g, (_, i) => urls[Number(i)]);
}

/** One argument of a log call, as text: an Error by its stack (or message), anything else as String() or JSON gives it. */
function textOf(value) {
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    if (typeof value === "string") return value;
    if (value === null || typeof value !== "object") return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

// -- The log ---------------------------------------------------------------------

/**
 * Check start()'s log option: "file" or "memory", or { mode } with either
 * ("memory" may say how many lines it keeps), or nothing.
 * @param {unknown} option
 * @returns {{ mode: "file" | "memory" | null, lines: number }}
 */
function checkLog(option) {
    if (option === undefined || option === false) return { mode: null, lines: MEMORY_LINES.default };
    const mode = typeof option === "string" ? option : option?.mode;
    if (mode !== "file" && mode !== "memory") {
        throw new Error('kit.start(): log must be "file" (debug.log in userData) or "memory" (in memory, on disk only if the person keeps it), or left out for the console only.');
    }
    const lines = typeof option === "object" && option.lines !== undefined ? option.lines : MEMORY_LINES.default;
    if (mode === "file" && typeof option === "object" && option.lines !== undefined) throw new Error("kit.start(): log.lines is for the memory log only.");
    if (!Number.isInteger(lines) || lines < MEMORY_LINES.min || lines > MEMORY_LINES.max) {
        throw new Error(`kit.start(): log.lines must be a whole number from ${MEMORY_LINES.min} to ${MEMORY_LINES.max}.`);
    }
    return { mode, lines };
}

/**
 * The app's log.
 * @param {{
 *   mode?: "file" | "memory" | null,
 *   dir?: string,
 *   lines?: number,
 *   level?: string,
 *   banner?: string,
 *   now?: () => Date,
 *   console?: Pick<Console, "error" | "warn" | "log">,
 *   fileSystem?: Pick<typeof fs, "writeFileSync" | "appendFileSync" | "rmSync">,
 * }} [options]
 *   dir: the folder the file goes in (userData). lines: how many of the run's
 *   last lines are kept in memory. level: LOG_LEVEL. banner: the first line's
 *   words. now, console and fileSystem stand in for a test.
 * @returns {{
 *   error(...args: unknown[]): void, warn(...args: unknown[]): void, info(...args: unknown[]): void, debug(...args: unknown[]): void,
 *   lines(): string[], keepOnDisk(on: boolean): void, onDisk(): boolean,
 *   file: string | null, mode: "file" | "memory" | null, level: string,
 * }}
 *   lines(): the banner and the run's last lines, as written. keepOnDisk():
 *   the memory log only: on, the run so far is written to the file and each
 *   line after it added; off, the file is deleted. onDisk(): whether lines are
 *   going to the file. file: where the file is, or would be.
 */
function createLog({ mode = null, dir, lines: size = MEMORY_LINES.default, level = process.env.LOG_LEVEL, banner = "App started", now = () => new Date(), console: out = console, fileSystem = fs } = {}) {
    const wanted = String(level || "INFO").toUpperCase();
    const keep = LEVELS[wanted] ?? LEVELS.INFO;
    const file = mode === "file" || mode === "memory" ? path.join(dir, LOG_FILE) : null;
    const first = `=== ${banner} at ${now().toISOString()} ===`;
    /** The run's last lines, after the banner, which is always kept. */
    const recent = [];
    // The memory log's is null until it's first told, which then always acts,
    // so a file an earlier run kept is deleted when it's not to be kept now.
    let disk = mode === "file" ? true : mode === "memory" ? null : false;
    let failing = false;

    /**
     * Do something to the file. A failure never throws into the app: it's
     * said once on the console, and the next line tries again, since a file
     * can be held for a moment (a virus scanner, on Windows).
     */
    function onFile(act) {
        try {
            act();
            failing = false;
        } catch (err) {
            if (!failing) out.error(`The log can't be written: ${redact(err.message)}`);
            failing = true;
        }
    }

    if (disk) onFile(() => fileSystem.writeFileSync(file, `${first}\n`));

    const at = (name) => (...args) => {
        if (LEVELS[name] > keep) return;
        const message = redact(args.map(textOf).join(" "));
        const line = `[${now().toISOString()}] [${name}] ${message}`;
        recent.push(line);
        if (recent.length > size) recent.shift();
        if (disk) onFile(() => fileSystem.appendFileSync(file, `${line}\n`));
        if (name === "ERROR") out.error(message);
        else if (name === "WARN") out.warn(message);
        else out.log(message);
    };

    /** The memory log: start or stop keeping it on disk. Asked again for what it's doing already, it does nothing. */
    function keepOnDisk(on) {
        if (mode !== "memory") throw new Error("Only the memory log can be kept on disk or not.");
        if (typeof on !== "boolean") throw new Error("keepOnDisk() takes true or false.");
        if (on === disk) return;
        disk = on;
        if (on) onFile(() => fileSystem.writeFileSync(file, `${[first, ...recent].join("\n")}\n`));
        else onFile(() => fileSystem.rmSync(file, { force: true }));
    }

    return {
        error: at("ERROR"),
        warn: at("WARN"),
        info: at("INFO"),
        debug: at("DEBUG"),
        lines: () => [first, ...recent],
        keepOnDisk,
        onDisk: () => disk === true,
        file,
        mode,
        level: Object.keys(LEVELS).find((name) => LEVELS[name] === keep),
    };
}

module.exports = { createLog, checkLog, redact, LEVELS, LOG_FILE, MEMORY_LINES };

"use strict";

// The app's log, as File Converter keeps it: four levels (ERROR, WARN, INFO,
// DEBUG), the least kept set by the LOG_LEVEL environment variable (INFO if
// it's not set), each line timed and levelled, and mirrored to the console.
//
// kit.start({ log: "file" }) writes it to debug.log in the app's userData
// folder, emptied at each launch and started with a banner, so the file is
// one run's. Without the option, the log goes to the console only. (A
// "memory" mode, a redacted ring buffer for Dropgate, comes in M5.)
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
 * Check start()'s log option: "file", or { mode: "file" }, or nothing.
 * @param {unknown} option
 * @returns {{ mode: "file" | null }}
 */
function checkLog(option) {
    if (option === undefined || option === false) return { mode: null };
    const mode = typeof option === "string" ? option : option?.mode;
    if (mode !== "file") throw new Error('kit.start(): log must be "file" (debug.log in userData), or left out for the console only.');
    return { mode };
}

/**
 * The app's log.
 * @param {{
 *   mode?: "file" | null,
 *   dir?: string,
 *   level?: string,
 *   banner?: string,
 *   now?: () => Date,
 *   console?: Pick<Console, "error" | "warn" | "log">,
 *   fileSystem?: Pick<typeof fs, "writeFileSync" | "appendFileSync">,
 * }} [options]
 *   dir: the folder the file goes in (userData). level: LOG_LEVEL. banner:
 *   the first line's words. now, console and fileSystem stand in for a test.
 * @returns {{ error(...args: unknown[]): void, warn(...args: unknown[]): void, info(...args: unknown[]): void, debug(...args: unknown[]): void, file: string | null, level: string }}
 */
function createLog({ mode = null, dir, level = process.env.LOG_LEVEL, banner = "App started", now = () => new Date(), console: out = console, fileSystem = fs } = {}) {
    const wanted = String(level || "INFO").toUpperCase();
    const keep = LEVELS[wanted] ?? LEVELS.INFO;
    const file = mode === "file" ? path.join(dir, LOG_FILE) : null;
    let writable = file !== null;

    /** Write to the file; a log that can't be written stops trying, rather than throwing into the app. */
    function toFile(write, text) {
        if (!writable) return;
        try {
            write(file, text);
        } catch (err) {
            writable = false;
            out.error(`The log can't be written: ${redact(err.message)}`);
        }
    }

    toFile(fileSystem.writeFileSync, `=== ${banner} at ${now().toISOString()} ===\n`);

    const at = (name) => (...args) => {
        if (LEVELS[name] > keep) return;
        const message = redact(args.map(textOf).join(" "));
        toFile(fileSystem.appendFileSync, `[${now().toISOString()}] [${name}] ${message}\n`);
        if (name === "ERROR") out.error(message);
        else if (name === "WARN") out.warn(message);
        else out.log(message);
    };
    return {
        error: at("ERROR"),
        warn: at("WARN"),
        info: at("INFO"),
        debug: at("DEBUG"),
        file,
        level: Object.keys(LEVELS).find((name) => LEVELS[name] === keep),
    };
}

module.exports = { createLog, checkLog, redact, LEVELS, LOG_FILE };

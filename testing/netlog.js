"use strict";

// Checking that an app's tests start nothing that leaves the machine: Dropgate's
// hard requirement 8, and every app's on the kit. Chromium writes down
// everything its network stack does in a net log (--log-net-log), as it does
// it; these read one after the app has quit.
//
//     const { netLogSwitches, assertNoOutsideLookups } = require("@diamonddigitaldev/electron-kit/testing");
//
//     const app = await electron.launch({ args: [...netLogSwitches(netLog), "."] });
//     … the test …
//     await app.close();
//     assertNoOutsideLookups(netLog);    // fails, naming each name looked up and each proxy search
//
// outsideLookups() gives every DNS lookup of a name that isn't this machine's
// own (loopback or "localhost"); a .local name counts, since its lookup goes
// out to the network by multicast. proxyLookups() gives each time the app
// looked for a proxy by itself (proxy settings that auto-detect or name a
// proxy script, a search for one, a lookup of "wpad"), which on a network with
// WPAD goes out to that network: netLogSwitches() turns that off with
// --no-proxy-server. Names and settings only: never a request or an answer.

const assert = require("assert");
const fs = require("fs");

/** A name that never leaves this machine: loopback, or "localhost" itself. */
const LOCAL_HOST = /^(?:127(?:\.\d+){3}|localhost|\[?::1\]?)$/i;

/** A host name WPAD looks up: "wpad", or "wpad" in a domain, with or without a scheme. */
const WPAD_HOST = /^(?:[a-z]+:\/\/)?wpad(?:[.:/]|$)/i;

/**
 * The switches an app's test launches it with: no proxy (so it never searches
 * for one), and a net log written to this file.
 * @param {string} file - Where the net log goes: in the test's own folder.
 * @returns {string[]}
 */
function netLogSwitches(file) {
    if (typeof file !== "string" || file === "") throw new TypeError("netLogSwitches() takes the net log's path.");
    return ["--no-proxy-server", `--log-net-log=${file}`];
}

/**
 * A net log's constants and events, or null for an empty one. It's valid
 * JSON only once the app has quit, so it's read a line at a time: the
 * constants on the first line, then one event per line; a line still being
 * written is skipped.
 * @param {string} file
 */
function readNetLog(file) {
    const text = fs.readFileSync(file, "utf8");
    // A launch that only hands its arguments to the app already running quits before its network stack starts.
    if (!text) return null;
    const [first, ...rest] = text.split("\n");
    const { constants } = JSON.parse(`${first.replace(/,\s*$/, "")}}`);
    const events = [];
    for (const line of rest) {
        if (!line.startsWith('{"')) continue;
        try {
            events.push(JSON.parse(line.replace(/\]?,?\s*$/, "")));
        } catch {
            // The line still being written when the app quit.
        }
    }
    return { constants, events };
}

/** A host as the log has it ("http://127.0.0.1:52443", "example.com:443"): its name alone. */
function hostName(host) {
    return /^(?:[a-z][a-z0-9+.-]*:\/\/)?(\[[^\]]*\]|[^:/]*)/i.exec(host)?.[1] ?? host;
}

/**
 * Every DNS lookup of a name that isn't this machine's own, one line each.
 * No log at all gives a line too, since there's then nothing to tell from.
 * @param {string} file - The net log.
 * @param {{ allow?: (string | RegExp)[] }} [options] - allow: names a test looks up on purpose.
 * @returns {string[]}
 */
function outsideLookups(file, { allow = [] } = {}) {
    if (!fs.existsSync(file)) return [`no net log at ${file}, so there's nothing to tell from`];
    const log = readNetLog(file);
    if (!log) return [];
    const request = log.constants.logEventTypes.HOST_RESOLVER_MANAGER_REQUEST;
    const begin = log.constants.logEventPhase.PHASE_BEGIN;
    const allowed = (name) => allow.some((entry) => (entry instanceof RegExp ? entry.test(name) : entry.toLowerCase() === name.toLowerCase()));

    const found = [];
    for (const event of log.events) {
        if (event.type !== request || event.phase !== begin) continue;
        const host = String(event.params?.host ?? "");
        const name = hostName(host);
        if (!LOCAL_HOST.test(name) && !allowed(name)) found.push(`a DNS lookup of ${host}`);
    }
    return found;
}

/**
 * Each time the app looked for a proxy by itself, one line each: proxy
 * settings that auto-detect or name a proxy script, a search for a proxy
 * script, and any DNS lookup of "wpad".
 * @param {string} file - The net log.
 * @returns {string[]}
 */
function proxyLookups(file) {
    if (!fs.existsSync(file)) return [`no net log at ${file}, so there's nothing to tell from`];
    const log = readNetLog(file);
    if (!log) return [];
    const { logEventTypes: types, logEventPhase: phases } = log.constants;

    const found = [];
    for (const event of log.events) {
        const config = event.params?.new_config;
        if (event.type === types.PROXY_CONFIG_CHANGED && (config?.auto_detect || config?.pac_url)) {
            found.push(`proxy settings that look for a proxy: ${JSON.stringify(config)}`);
        } else if (event.type === types.PAC_FILE_DECIDER && event.phase === phases.PHASE_BEGIN) {
            found.push("a search for a proxy script");
        } else if (event.type === types.HOST_RESOLVER_MANAGER_REQUEST && event.phase === phases.PHASE_BEGIN && WPAD_HOST.test(String(event.params?.host ?? ""))) {
            found.push(`a DNS lookup of ${event.params.host}`);
        }
    }
    return [...new Set(found)];
}

/**
 * Fail if a run looked up any name beyond this machine, or looked for a proxy
 * by itself, naming each.
 * @param {string} file - The net log, once the app has quit.
 * @param {{ allow?: (string | RegExp)[] }} [options] - allow: names a test looks up on purpose.
 */
function assertNoOutsideLookups(file, options) {
    const found = [...new Set([...outsideLookups(file, options), ...proxyLookups(file)])];
    if (found.length) {
        throw new assert.AssertionError({ message: `The app reached beyond this machine (${file}):\n${found.map((line) => `  - ${line}`).join("\n")}` });
    }
}

module.exports = { netLogSwitches, outsideLookups, proxyLookups, assertNoOutsideLookups, LOCAL_HOST };

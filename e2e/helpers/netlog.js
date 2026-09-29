"use strict";

// A run's net log (Chromium's --log-net-log), read after the app has quit: the
// names its network stack looked up beyond this machine. A lookup like that
// goes out to the network's DNS server, so a test should never start one.
//
// The log is one JSON object, written as the app runs: its constants on the
// first line, then one event per line. It's read a line at a time, so a log
// cut short still reads. Names only: never a request or an answer.

const fs = require("fs");

/** A name that never leaves this machine: loopback, or "localhost" itself. */
const LOCAL_HOST = /^(?:127(?:\.\d+){3}|localhost|\[?::1\]?)$/i;

/**
 * Every DNS lookup of a name that isn't this machine's own, one line each.
 * @param {string} file - The net log.
 * @returns {string[]}
 */
function outsideLookups(file) {
    if (!fs.existsSync(file)) return [`no net log at ${file}, so there's nothing to tell from`];
    const text = fs.readFileSync(file, "utf8");
    if (!text) return [];

    const [first, ...rest] = text.split("\n");
    const { constants } = JSON.parse(`${first.replace(/,\s*$/, "")}}`);
    const request = constants.logEventTypes.HOST_RESOLVER_MANAGER_REQUEST;
    const begin = constants.logEventPhase.PHASE_BEGIN;

    const found = [];
    for (const line of rest) {
        if (!line.startsWith('{"')) continue;
        let event;
        try {
            event = JSON.parse(line.replace(/\]?,?\s*$/, ""));
        } catch {
            continue; // The line still being written when the app quit.
        }
        if (event.type !== request || event.phase !== begin) continue;
        // The host comes as a scheme, host and port ("http://127.0.0.1:52443"), or a host and port.
        const host = String(event.params?.host ?? "");
        const name = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(\[[^\]]*\]|[^:/]*)/i.exec(host)?.[1] ?? host;
        if (!LOCAL_HOST.test(name)) found.push(`a DNS lookup of ${host}`);
    }
    return found;
}

module.exports = { outsideLookups };

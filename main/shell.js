"use strict";

// shell:open-external: the page asks the OS to open a link in the person's
// browser (a credits link, the donate and source buttons). The page has no
// shell of its own, and only an http(s) URL is ever handed to the OS, whatever
// the page asked for: a file:, javascript: or custom-scheme URL could run
// something on the machine.

const { shell } = require("electron");

/**
 * Whether a value is an absolute http: or https: URL, with a host.
 * @param {unknown} value
 * @returns {boolean}
 */
function isWebUrl(value) {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
    } catch {
        return false;
    }
}

/**
 * Open a link in the person's browser: http(s) only. Anything else is refused
 * with an error that doesn't repeat what was asked for.
 * @param {unknown} url
 * @returns {Promise<void>}
 */
async function openExternal(url) {
    if (!isWebUrl(url)) throw new Error("electron-kit opens http and https links only.");
    await shell.openExternal(url);
}

module.exports = { isWebUrl, openExternal };

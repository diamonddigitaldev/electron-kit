"use strict";

// shell:open-external: the page asks the OS to open a link in the person's
// browser (a credits link, the donate and source buttons). The page has no
// shell of its own, and only an http(s) URL is ever handed to the OS, whatever
// the page asked for: a file:, javascript: or custom-scheme URL could run
// something on the machine.
//
// An app can narrow that to its own allowlist (kit.start({ openExternal:
// { allow } })): then a link opens only if it's on a site the list names, and
// under the path it gives. Each entry is matched as a URL, by its scheme, host
// and port exactly and its path by whole segments, never as text: an entry
// "https://diamonddigital.dev" doesn't let "https://diamonddigital.dev.example.com"
// through, nor "https://github.com/diamonddigitaldev" let
// "https://github.com/diamonddigitaldev-fake". The links the kit shows from the
// app's own config (its credit lines' links, the donate link, its repository
// and so its releases) are always allowed, so the Credits and Update tabs keep
// working.

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
 * Check start()'s openExternal option: { allow: [an http(s) URL, …] }, or
 * nothing. Each entry has no user name, password, query or fragment.
 * @param {unknown} option
 * @returns {string[] | null} The list, or null for any http(s) link.
 */
function checkOpenExternal(option) {
    if (option === undefined) return null;
    const fail = (message) => {
        throw new Error(`kit.start(): openExternal${message}`);
    };
    if (option === null || typeof option !== "object" || Object.keys(option).some((key) => key !== "allow")) fail(" must be { allow: [the links' sites] }, or left out for any http(s) link.");
    if (!Array.isArray(option.allow) || option.allow.length === 0) fail(".allow must be a list of the sites links may open on, such as \"https://github.com/diamonddigitaldev/\".");
    for (const entry of option.allow) {
        if (!isWebUrl(entry)) fail(`.allow: ${JSON.stringify(entry)} isn't an http(s) URL.`);
        const url = new URL(entry);
        if (url.username || url.password || url.search || url.hash) fail(`.allow: ${JSON.stringify(entry)} must have no user name, query or fragment.`);
    }
    return [...option.allow];
}

/**
 * Whether a link is under an allowlist entry: the same scheme, host and port,
 * and a path that's the entry's or inside it, by whole segments.
 * @param {URL} url
 * @param {string} entry
 */
function isUnder(url, entry) {
    const base = new URL(entry);
    if (url.protocol !== base.protocol || url.host !== base.host) return false;
    const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    return url.pathname === base.pathname || url.pathname.startsWith(prefix);
}

/**
 * The open-external the app's page gets: http(s) only, and only on the
 * allowlist when there is one, with the links the kit itself shows.
 * @param {{ allow?: string[] | null, kitLinks?: () => (string | null)[], open?: (url: string) => Promise<void> }} [options]
 *   allow: the app's allowlist, or null for any http(s) link. kitLinks: the
 *   links the kit shows from the app's config, asked for when a link is
 *   checked (the repository may be read from package.json). open: the OS's
 *   shell, unless a test stands one in.
 * @returns {(url: unknown) => Promise<void>}
 */
function createOpener({ allow = null, kitLinks = () => [], open = (url) => shell.openExternal(url) } = {}) {
    return async function openExternal(url) {
        if (!isWebUrl(url)) throw new Error("electron-kit opens http and https links only.");
        if (allow !== null) {
            const link = new URL(url);
            const entries = [...allow, ...kitLinks().filter(isWebUrl)];
            if (!entries.some((entry) => isUnder(link, entry))) throw new Error("electron-kit opens links on the app's allowlist only.");
        }
        await open(url);
    };
}

/**
 * Open a link in the person's browser: http(s) only. Anything else is refused
 * with an error that doesn't repeat what was asked for.
 * @param {unknown} url
 * @returns {Promise<void>}
 */
const openExternal = createOpener();

module.exports = { isWebUrl, isUnder, checkOpenExternal, createOpener, openExternal };

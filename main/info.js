"use strict";

// app:get-info: what the Settings view's Credits tab shows. The app's name and
// version (Electron's, from its package.json), the repository its source is in,
// its credit lines and the donate link.
//
// The credits come from kit.start({ credits }):
//
//     credits: {
//         lines: [
//             ["Created and maintained by ", { text: "Diamond Digital Development", href: "https://diamonddigital.dev" }, "."],
//             "This software is licensed under the Apache 2.0 license.",
//         ],
//         donate: "https://buymeacoff.ee/…",   // optional: the donate line and button
//     },
//     repository: "https://github.com/…",       // optional: the package.json's repository otherwise
//
// Each line is a sentence, or a list of parts (text, and links of { text, href }).
// The page puts the house "•" before each. Every link must be http(s): it opens
// through shell:open-external, which opens nothing else. It's all checked when
// kit.start() is called, so a mistake shows at once, not on the Credits tab.

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { isWebUrl } = require("./shell");

/**
 * A package.json repository as an https URL: "git+https://…/x.git" and
 * { url: "…" } become "https://…/x". Anything else (a shorthand, ssh) is null.
 * @param {unknown} repository
 * @returns {string | null}
 */
function repositoryUrl(repository) {
    const raw = typeof repository === "object" && repository !== null ? repository.url : repository;
    if (typeof raw !== "string") return null;
    const url = raw.replace(/^git\+/, "").replace(/\.git$/, "");
    return isWebUrl(url) && url.startsWith("https:") ? url : null;
}

/** The app's own package.json repository, or null. */
function packageRepository() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8"));
        return repositoryUrl(pkg.repository);
    } catch {
        return null;
    }
}

/**
 * Check kit.start()'s credits and repository, and return them in the form
 * app:get-info hands out: each line a list of parts. Throws on a mistake.
 * @param {{ credits?: { lines?: unknown[], donate?: string }, repository?: string }} config
 */
function checkInfo({ credits = {}, repository } = {}) {
    const fail = (message) => {
        throw new Error(`kit.start(): ${message}`);
    };
    if (typeof credits !== "object" || credits === null) fail("credits must be an object.");
    const { lines = [], donate = null } = credits;
    if (!Array.isArray(lines)) fail("credits.lines must be a list.");

    const parts = lines.map((line, i) => {
        const list = typeof line === "string" ? [line] : line;
        if (!Array.isArray(list) || list.length === 0) fail(`credits.lines[${i}] must be a sentence or a list of parts.`);
        return list.map((part, j) => {
            if (typeof part === "string") return part;
            const where = `credits.lines[${i}][${j}]`;
            if (typeof part !== "object" || part === null || typeof part.text !== "string" || part.text === "") fail(`${where} must be text, or a link of { text, href }.`);
            if (!isWebUrl(part.href)) fail(`${where}'s href must be an http(s) URL.`);
            return { text: part.text, href: part.href };
        });
    });
    if (donate !== null && !isWebUrl(donate)) fail("credits.donate must be an http(s) URL.");
    if (repository !== undefined && !isWebUrl(repository)) fail("repository must be an http(s) URL.");

    return { lines: parts, donate, repository: repository ?? null };
}

/**
 * app:get-info's answer: { name, version, repository, credits: { lines, donate } }.
 * @param {ReturnType<typeof checkInfo>} info - what checkInfo() returned.
 */
function appInfo({ lines, donate, repository }) {
    return {
        name: app.getName(),
        version: app.getVersion(),
        repository: repository ?? packageRepository(),
        credits: { lines, donate },
    };
}

module.exports = { checkInfo, appInfo, repositoryUrl };

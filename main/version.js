"use strict";

// Versions and update channels, for the updater (updater.js). From File
// Converter's core/version.js, with the update channel added.
//
// Someone chooses an update channel in Settings > Update:
//
//     stable   finished releases only           2.1.0
//     beta     betas and finished releases       2.1.0-beta.1, 2.1.0
//     alpha    every build, alphas included      2.1.0-alpha.3, 2.1.0-beta.1, 2.1.0
//
// isOfferableUpdate() is the rule every update found must pass before it's
// offered or downloaded: strictly newer than what's running, and in the
// chosen channel. electron-updater reads the channels the same way, but the
// kit checks again itself, so a release mis-tagged on GitHub (a beta put up as
// a finished release) never reaches someone on Stable, and nothing older is
// ever offered, whatever electron-updater's own settings say.

/** The update channels, in the order the Update tab lists them. */
const CHANNELS = Object.freeze(["stable", "beta", "alpha"]);

/**
 * Split a version into its parts, or null if it isn't one.
 * @param {unknown} version - "1.2.3", "v2.0.0-alpha.1", "1.0.0+build.5"
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[] } | null}
 */
function parse(version) {
    if (typeof version !== "string") return null;
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split(".") : [],
    };
}

/** Whether a version is a pre-release (alpha, beta, rc…). */
function isPrerelease(version) {
    const parsed = parse(version);
    return parsed ? parsed.prerelease.length > 0 : false;
}

/**
 * Compare two versions: -1 if a comes before b, 0 if they're the same, 1 if
 * after. A version that can't be read comes before any that can.
 */
function compare(a, b) {
    const pa = parse(a);
    const pb = parse(b);
    if (!pa && !pb) return 0;
    if (!pa) return -1;
    if (!pb) return 1;

    for (const part of ["major", "minor", "patch"]) {
        if (pa[part] !== pb[part]) return pa[part] < pb[part] ? -1 : 1;
    }

    // A pre-release comes before its own release: 2.0.0-alpha.1 before 2.0.0.
    if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
    if (pa.prerelease.length === 0) return 1;
    if (pb.prerelease.length === 0) return -1;

    const length = Math.max(pa.prerelease.length, pb.prerelease.length);
    for (let i = 0; i < length; i++) {
        const ai = pa.prerelease[i];
        const bi = pb.prerelease[i];
        if (ai === undefined) return -1;
        if (bi === undefined) return 1;
        if (ai === bi) continue;

        const an = /^\d+$/.test(ai);
        const bn = /^\d+$/.test(bi);
        // Numbers compare as numbers, and come before words.
        if (an && bn) return Number(ai) < Number(bi) ? -1 : 1;
        if (an) return -1;
        if (bn) return 1;
        return ai < bi ? -1 : 1;
    }
    return 0;
}

/**
 * The channel a version belongs to: an -alpha build is Alpha's, a -beta build
 * Beta's, and anything else Stable's. The Update tab starts on the running
 * build's own channel, until someone chooses one.
 * @param {string} version
 * @returns {"stable" | "beta" | "alpha"}
 */
function channelOf(version) {
    const tag = parse(version)?.prerelease[0]?.toLowerCase();
    return tag === "alpha" || tag === "beta" ? tag : "stable";
}

/**
 * Whether a version is one the channel offers: Stable takes finished releases
 * only, Beta betas too, and Alpha anything.
 * @param {string} version
 * @param {string} channel
 */
function isInChannel(version, channel) {
    const tag = parse(version)?.prerelease[0]?.toLowerCase();
    if (tag === undefined) return true;
    if (channel === "alpha") return true;
    return channel === "beta" && tag === "beta";
}

/**
 * Whether `candidate` should be offered to someone running `current` on
 * `channel`: only if it's strictly newer, and in the channel. Never a
 * downgrade: someone who moves from Alpha to Stable keeps their alpha until a
 * newer finished release arrives.
 * @param {unknown} candidate - the version the update server has
 * @param {string} current - the version running
 * @param {string} channel - "stable", "beta" or "alpha"
 */
function isOfferableUpdate(candidate, current, channel) {
    if (!CHANNELS.includes(channel)) return false;
    if (!parse(candidate)) return false;
    if (!isInChannel(candidate, channel)) return false;
    return compare(candidate, current) > 0;
}

module.exports = { CHANNELS, parse, isPrerelease, compare, channelOf, isInChannel, isOfferableUpdate };

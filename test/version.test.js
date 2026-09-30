"use strict";

// Versions and update channels (main/version.js): File Converter's
// core/version.js tests, and the channel each version belongs to, and is
// offered in.

const test = require("node:test");
const assert = require("node:assert/strict");
const v = require("../main/version");

test("version: parses plain and pre-release versions", () => {
    assert.deepEqual(v.parse("1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: [] });
    assert.deepEqual(v.parse("2.0.0-alpha.1"), { major: 2, minor: 0, patch: 0, prerelease: ["alpha", "1"] });
    assert.deepEqual(v.parse("v1.0.0"), { major: 1, minor: 0, patch: 0, prerelease: [] });
    assert.deepEqual(v.parse("1.0.0+build.5"), { major: 1, minor: 0, patch: 0, prerelease: [] });
    assert.equal(v.parse("not-a-version"), null);
    assert.equal(v.parse("1.0"), null);
    assert.equal(v.parse(null), null);
});

test("version: identifies pre-releases", () => {
    assert.equal(v.isPrerelease("2.0.0-alpha.1"), true);
    assert.equal(v.isPrerelease("2.0.0-beta"), true);
    assert.equal(v.isPrerelease("2.0.0-rc.2"), true);
    assert.equal(v.isPrerelease("2.0.0"), false);
    assert.equal(v.isPrerelease("garbage"), false);
});

test("version: orders by major, minor, patch, numerically", () => {
    assert.equal(v.compare("1.0.0", "2.0.0"), -1);
    assert.equal(v.compare("2.0.0", "1.0.0"), 1);
    assert.equal(v.compare("1.2.0", "1.10.0"), -1, "compares numerically, not as text");
    assert.equal(v.compare("1.0.10", "1.0.9"), 1);
    assert.equal(v.compare("1.0.0", "1.0.0"), 0);
});

test("version: a pre-release comes before its own release, and pre-releases in order", () => {
    assert.equal(v.compare("2.0.0-alpha.1", "2.0.0"), -1);
    assert.equal(v.compare("2.0.0", "2.0.0-alpha.1"), 1);
    assert.equal(v.compare("2.0.0-alpha.1", "2.0.0-alpha.2"), -1);
    assert.equal(v.compare("2.0.0-alpha.2", "2.0.0-beta.1"), -1);
    assert.equal(v.compare("2.0.0-beta.2", "2.0.0-beta.10"), -1);
    assert.equal(v.compare("2.0.0-alpha.1", "2.0.0-alpha.1"), 0);
    assert.equal(v.compare("2.0.0-alpha", "2.0.0-alpha.1"), -1, "a longer chain with the same start comes after");
    assert.equal(v.compare("1.0.0-1", "1.0.0-alpha"), -1, "numbers come before words");
});

test("version: something that isn't a version comes before any that is", () => {
    assert.equal(v.compare("latest", "1.0.0"), -1);
    assert.equal(v.compare("1.0.0", "latest"), 1);
    assert.equal(v.compare("x", "y"), 0);
});

test("channels: stable, beta and alpha, in that order", () => {
    assert.deepEqual(v.CHANNELS, ["stable", "beta", "alpha"]);
});

test("channels: a build belongs to alpha or beta by its tag, and to stable otherwise", () => {
    assert.equal(v.channelOf("2.0.0-alpha.1"), "alpha");
    assert.equal(v.channelOf("2.0.0-alpha"), "alpha");
    assert.equal(v.channelOf("2.0.0-beta.2"), "beta");
    assert.equal(v.channelOf("2.0.0-Beta.2"), "beta");
    assert.equal(v.channelOf("2.0.0-rc.1"), "stable");
    assert.equal(v.channelOf("2.0.0"), "stable");
    assert.equal(v.channelOf("not-a-version"), "stable");
});

test("channels: Stable offers finished releases, Beta betas too, Alpha anything", () => {
    const offers = (channel) => ["2.1.0", "2.1.0-beta.1", "2.1.0-alpha.1", "2.1.0-rc.1"].filter((version) => v.isInChannel(version, channel));
    assert.deepEqual(offers("stable"), ["2.1.0"]);
    assert.deepEqual(offers("beta"), ["2.1.0", "2.1.0-beta.1"]);
    assert.deepEqual(offers("alpha"), ["2.1.0", "2.1.0-beta.1", "2.1.0-alpha.1", "2.1.0-rc.1"]);
});

test("update: a newer version in the channel is offered", () => {
    assert.equal(v.isOfferableUpdate("1.1.0", "1.0.0", "stable"), true);
    assert.equal(v.isOfferableUpdate("2.1.0-beta.1", "2.0.0", "beta"), true);
    assert.equal(v.isOfferableUpdate("2.0.0-beta.3", "2.0.0-beta.2", "beta"), true);
    assert.equal(v.isOfferableUpdate("2.0.0-alpha.2", "2.0.0-alpha.1", "alpha"), true);
    assert.equal(v.isOfferableUpdate("2.1.0", "2.0.0-alpha.1", "alpha"), true, "Alpha takes a finished release too");
});

test("update: Stable never offers a pre-release, whatever is running (a mis-tagged release)", () => {
    assert.equal(v.isOfferableUpdate("2.0.0-alpha.1", "1.0.0", "stable"), false);
    assert.equal(v.isOfferableUpdate("2.0.0-beta.3", "2.0.0-beta.2", "stable"), false);
    assert.equal(v.isOfferableUpdate("3.0.0-rc.1", "2.0.0", "stable"), false);
});

test("update: Beta never offers an alpha", () => {
    assert.equal(v.isOfferableUpdate("2.1.0-alpha.1", "2.0.0", "beta"), false);
    assert.equal(v.isOfferableUpdate("2.1.0-rc.1", "2.0.0", "beta"), false);
});

test("update: someone on a pre-release is offered the finished release that supersedes it", () => {
    assert.equal(v.isOfferableUpdate("2.0.0", "2.0.0-alpha.1", "stable"), true);
    assert.equal(v.isOfferableUpdate("2.0.0", "2.0.0-beta.2", "beta"), true);
});

test("update: never a downgrade, including after moving from Alpha to Stable", () => {
    assert.equal(v.isOfferableUpdate("1.0.0", "2.0.0-alpha.1", "stable"), false);
    assert.equal(v.isOfferableUpdate("2.0.0-alpha.1", "2.0.0-beta.1", "alpha"), false);
    assert.equal(v.isOfferableUpdate("1.9.9", "2.0.0", "alpha"), false);
});

test("update: the same version is not an update", () => {
    assert.equal(v.isOfferableUpdate("1.0.0", "1.0.0", "stable"), false);
    assert.equal(v.isOfferableUpdate("2.0.0-alpha.1", "2.0.0-alpha.1", "alpha"), false);
});

test("update: garbage, or a channel that isn't one, is never offered", () => {
    for (const candidate of [null, undefined, "", "latest", 2]) assert.equal(v.isOfferableUpdate(candidate, "1.0.0", "alpha"), false, String(candidate));
    for (const channel of ["latest", "nightly", null, undefined]) assert.equal(v.isOfferableUpdate("2.0.0", "1.0.0", channel), false, String(channel));
});

test("the kit's version helpers are the ones kit's main hands apps", () => {
    const { loadMain } = require("./helpers/main");
    const { main } = loadMain();
    assert.equal(main.version.isOfferableUpdate("2.0.0", "1.0.0", "stable"), true);
    assert.deepEqual(Object.keys(main.version).sort(), Object.keys(v).sort());
});

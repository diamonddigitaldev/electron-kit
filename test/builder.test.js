"use strict";

// builder/base.json, the electron-builder config every app extends, and
// assertBuildExtendsKit(), which an app's tests use to check it does.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { assertBuildExtendsKit, KIT_BASE } = require("../testing");
const kitPackage = require("../package.json");
const demoPackage = require("../demo/package.json");

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "builder", "base.json"), "utf8"));

test("the base config: every channel's update file, NSIS on Windows under the house's menu folder, and AppImage, .deb and .rpm on Linux, with a maintainer", () => {
    assert.deepEqual(BASE, {
        generateUpdatesFilesForAllChannels: true,
        win: { target: ["nsis"] },
        nsis: { menuCategory: "Diamond Digital Development" },
        linux: {
            target: ["AppImage", "deb", "rpm"],
            // Every app's package.json author is "Name <https://…>", which npm reads as an email.
            maintainer: "Diamond Digital Development <will.knowles@diamonddigital.dev>",
        },
    });
});

test("the base config holds nothing an app must set itself, since an app can add to its lists but never take from them", () => {
    // electron-builder merges extends deeply: objects key by key, the app's winning, and lists joined.
    for (const key of ["appId", "productName", "artifactName", "publish", "files", "extraResources", "fileAssociations", "directories"]) {
        assert.ok(!Object.hasOwn(BASE, key), key);
    }
});

test("the package ships the base config, and exports it by name", () => {
    assert.ok(kitPackage.files.includes("builder/"));
    assert.equal(kitPackage.exports["./builder/*"], "./builder/*");
    assert.equal(KIT_BASE, "@diamonddigitaldev/electron-kit/builder/base.json");
    assert.equal(require.resolve(KIT_BASE), path.join(__dirname, "..", "builder", "base.json"));
});

test("the demo extends it, and publishes to the local update server its packaged tests run", () => {
    assert.doesNotThrow(() => assertBuildExtendsKit(demoPackage));
    assert.deepEqual(demoPackage.build.publish, { provider: "generic", url: "http://127.0.0.1:47613/" });
});

test("assertBuildExtendsKit() fails a config that doesn't extend the base, turns its channel files off, or has nowhere to update from", () => {
    const good = { build: { extends: KIT_BASE, publish: { provider: "github" } } };
    assert.doesNotThrow(() => assertBuildExtendsKit(good));
    assert.doesNotThrow(() => assertBuildExtendsKit({ build: { ...good.build, extends: ["other.json", `node_modules/${KIT_BASE}`] } }));
    for (const [pkg, error] of [
        [{}, /must name "@diamonddigitaldev\/electron-kit\/builder\/base\.json"/],
        [{ build: { publish: {} } }, /must name/],
        [{ build: { ...good.build, extends: "base.json" } }, /must name/],
        [{ build: { ...good.build, generateUpdatesFilesForAllChannels: false } }, /must stay on/],
        [{ build: { extends: KIT_BASE } }, /build\.publish must name/],
    ]) {
        assert.throws(() => assertBuildExtendsKit(pkg), error, JSON.stringify(pkg));
    }
});

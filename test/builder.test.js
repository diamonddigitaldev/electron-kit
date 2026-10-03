"use strict";

// builder/base.json, the electron-builder config every app extends; config(),
// which builds an app's whole config on it; and assertBuildExtendsKit(), which
// an app's tests use to check it does.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { assertBuildExtendsKit, KIT_BASE } = require("../testing");
const { config, LINUX_CATEGORIES, MIME_TYPES, ALL_FILES } = require("../builder");
const kitPackage = require("../package.json");
const demoPackage = require("../demo/package.json");

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "builder", "base.json"), "utf8"));

/** The demo's electron-builder.js, with the kit it requires being this checkout (the demo's own copy may not be installed). */
function loadDemoBuild() {
    const resolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
        if (request === "@diamonddigitaldev/electron-kit/builder") return require.resolve("../builder");
        return resolve.call(this, request, ...rest);
    };
    try {
        return require("../demo/electron-builder.js");
    } finally {
        Module._resolveFilename = resolve;
    }
}

const PKG = Object.freeze({ name: "app", version: "1.0.0" });
const BUILD = Object.freeze({
    appId: "com.diamonddigitaldev.app",
    productName: "App",
    publish: { provider: "github", owner: "diamonddigitaldev", repo: "App" },
    linux: { icon: "src/app.png", category: "AudioVideo" },
});

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

test("the package ships the base config and config(), and exports them by name", () => {
    assert.ok(kitPackage.files.includes("builder/"));
    assert.equal(kitPackage.exports["./builder/*"], "./builder/*");
    assert.equal(kitPackage.exports["./builder"], "./builder/index.js");
    assert.equal(KIT_BASE, "@diamonddigitaldev/electron-kit/builder/base.json");
    assert.equal(require.resolve(KIT_BASE), path.join(__dirname, "..", "builder", "base.json"));
});

test("the demo builds with config(), and publishes to the local update server its packaged tests run", () => {
    assert.equal(demoPackage.build, undefined, "package.json's build would win over electron-builder.js");
    const demo = loadDemoBuild();
    assert.doesNotThrow(() => assertBuildExtendsKit(demo));
    assert.deepEqual(demo.publish, { provider: "generic", url: "http://127.0.0.1:47613/" });
    assert.equal(demo.extraMetadata.desktopName, "com.diamonddigitaldev.electronkitdemo.desktop");
    assert.deepEqual(demo.linux.mimeTypes, ["text/plain", "text/markdown"]);
});

test("config(): the app's build on the kit's base, with the .desktop file named for its appId", () => {
    const built = config(PKG, { build: BUILD });
    assert.deepEqual(built, {
        ...BUILD,
        extends: KIT_BASE,
        extraMetadata: { desktopName: "com.diamonddigitaldev.app.desktop" },
        linux: { icon: "src/app.png", category: "AudioVideo", syncDesktopName: true },
    });
    assert.doesNotThrow(() => assertBuildExtendsKit(built));
    // The app's own options are left as they were.
    assert.deepEqual(BUILD.linux, { icon: "src/app.png", category: "AudioVideo" });
    // Its own extraMetadata is kept.
    assert.deepEqual(config(PKG, { build: { ...BUILD, extraMetadata: { main: "src/main.js" } } }).extraMetadata, {
        main: "src/main.js",
        desktopName: "com.diamonddigitaldev.app.desktop",
    });
    // package.json may say the same desktopName.
    assert.doesNotThrow(() => config({ ...PKG, desktopName: "com.diamonddigitaldev.app.desktop" }, { build: BUILD }));
});

test("config(): file types become the .desktop file's MIME types, every name each is known by, with %F", () => {
    const built = config(PKG, {
        build: BUILD,
        fileTypes: [
            { name: "Audio File", ext: ["mp3", "ogg"] },
            { name: "Video File", ext: ["mp4", "m4v"] },
            { name: "Project", ext: ["dgp"], mimeTypes: { dgp: "application/x-dgp-project" } },
        ],
    });
    assert.deepEqual(built.linux.mimeTypes, [
        "audio/mpeg", "audio/mp3",
        "audio/ogg", "audio/x-vorbis+ogg", "audio/x-flac+ogg", "audio/x-opus+ogg",
        "video/mp4", "video/x-m4v",
        "application/x-dgp-project",
    ]);
    assert.deepEqual(built.linux.executableArgs, ["%F"]);
    assert.equal(built.fileAssociations, undefined, "electron-builder's own associations claim every type on Windows without asking");
    assert.equal(built.win, undefined);
});

test("config(): allFiles puts the app in Open With for any file", () => {
    const built = config(PKG, { build: BUILD, allFiles: true });
    assert.equal(ALL_FILES, "application/octet-stream");
    assert.deepEqual(built.linux.mimeTypes, [ALL_FILES]);
    assert.deepEqual(built.linux.executableArgs, ["%F"]);
});

test("config(): every extension the house's apps open has its MIME types in the kit's table", () => {
    // File Converter's 22; Media Player's are among them.
    for (const ext of ["mp3", "wav", "flac", "ogg", "aac", "m4a", "opus", "wma", "mp4", "mkv", "webm", "avi", "mov", "wmv", "flv", "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"]) {
        assert.ok(MIME_TYPES[ext]?.length > 0, ext);
    }
    for (const [ext, types] of Object.entries(MIME_TYPES)) {
        assert.match(ext, /^[a-z0-9]+$/);
        for (const type of types) assert.match(type, /^(audio|video|image|text|application)\/[a-z0-9.+-]+$/, `${ext}: ${type}`);
    }
});

test("config() refuses what would claim types without asking, or leave the .desktop file wrong", () => {
    const cases = [
        [[null, { build: BUILD }], /first argument is the app's package\.json/],
        [[{ ...PKG, build: {} }, { build: BUILD }], /package\.json still has build/],
        [[PKG, { build: BUILD, contextMenus: {} }], /"contextMenus" isn't an option/],
        [[PKG, {}], /build must be the app's electron-builder options/],
        [[PKG, { build: { ...BUILD, extends: KIT_BASE } }], /build\.extends is the kit's to set/],
        [[PKG, { build: { ...BUILD, fileAssociations: [{ ext: "mp3" }] } }], /build\.fileAssociations is the kit's to set/],
        [[PKG, { build: { ...BUILD, win: { fileAssociations: [{ ext: "*" }] } } }], /build\.win\.fileAssociations is the kit's/],
        [[PKG, { build: { ...BUILD, linux: { ...BUILD.linux, mimeTypes: ["text/plain"] } } }], /build\.linux\.mimeTypes is the kit's/],
        [[PKG, { build: { ...BUILD, linux: { ...BUILD.linux, executableArgs: ["%U"] } } }], /build\.linux\.executableArgs is the kit's/],
        [[PKG, { build: { ...BUILD, extraMetadata: { desktopName: "app.desktop" } } }], /desktopName is the kit's/],
        [[PKG, { build: { ...BUILD, appId: "App" } }], /build\.appId must be/],
        [[PKG, { build: { ...BUILD, linux: { icon: "x.png" } } }], /build\.linux\.category must be one of/],
        [[PKG, { build: { ...BUILD, linux: { category: "Multimedia" } } }], /build\.linux\.category must be one of/],
        [[{ ...PKG, desktopName: "app.desktop" }, { build: BUILD }], /desktopName must be "com\.diamonddigitaldev\.app\.desktop"/],
        [[PKG, { build: BUILD, allFiles: true, fileTypes: [{ name: "A", ext: ["mp3"] }] }], /fileTypes or allFiles, not both/],
        [[PKG, { build: BUILD, allFiles: "yes" }], /allFiles must be true or false/],
        [[PKG, { build: BUILD, fileTypes: [] }], /fileTypes must be a list of groups/],
        [[PKG, { build: BUILD, fileTypes: [{ ext: ["mp3"] }] }], /needs a name/],
        [[PKG, { build: BUILD, fileTypes: [{ name: "Audio File", ext: [] }] }], /needs ext/],
        [[PKG, { build: BUILD, fileTypes: [{ name: "All Files", ext: ["*"] }] }], /sets allFiles: true/],
        [[PKG, { build: BUILD, fileTypes: [{ name: "Audio File", ext: [".mp3"] }] }], /"\.mp3" isn't an extension/],
        [[PKG, { build: BUILD, fileTypes: [{ name: "Audio File", ext: ["MP3"] }] }], /"MP3" isn't an extension/],
        [[PKG, { build: BUILD, fileTypes: [{ name: "A", ext: ["mp3"] }, { name: "B", ext: ["mp3"] }] }], /"mp3" is listed twice/],
        [[PKG, { build: BUILD, fileTypes: [{ name: "Project", ext: ["dgp"] }] }], /doesn't know the MIME type of "dgp"/],
        [[PKG, { build: BUILD, fileTypes: [{ name: "Project", ext: ["dgp"], mimeTypes: { dgp: "dgp" } }] }], /doesn't know the MIME type of "dgp"/],
    ];
    for (const [args, error] of cases) {
        assert.throws(() => config(...args), error, JSON.stringify(args[1]));
    }
    assert.ok(LINUX_CATEGORIES.includes("AudioVideo") && LINUX_CATEGORIES.includes("Network"));
});

test("assertBuildExtendsKit() takes the config itself, or a package.json whose build holds it", () => {
    assert.doesNotThrow(() => assertBuildExtendsKit(config(PKG, { build: BUILD })));
    assert.throws(() => assertBuildExtendsKit(BUILD), /must name/);
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

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
const { config, LINUX_CATEGORIES, MIME_TYPES, ALL_FILES, INSTALLER_DIR } = require("../builder");
const { installerScript, nsisString } = require("../builder/installer");
const kitPackage = require("../package.json");
const demoPackage = require("../demo/package.json");

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "builder", "base.json"), "utf8"));

/** The demo's electron-builder.cjs, with the kit it requires being this checkout (the demo's own copy may not be installed). */
function loadDemoBuild() {
    const resolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
        if (request === "@diamonddigitaldev/electron-kit/builder") return require.resolve("../builder");
        return resolve.call(this, request, ...rest);
    };
    try {
        return require("../demo/electron-builder.cjs");
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
    assert.equal(demoPackage.build, undefined, "package.json's build would win over electron-builder.cjs");
    const demo = loadDemoBuild();
    assert.doesNotThrow(() => assertBuildExtendsKit(demo));
    assert.deepEqual(demo.publish, { provider: "generic", url: "http://127.0.0.1:47613/" });
    assert.equal(demo.extraMetadata.desktopName, "com.diamonddigitaldev.electronkitdemo.desktop");
    assert.deepEqual(demo.linux.mimeTypes, ["text/plain", "text/markdown"]);
});

test("config(): the app's build on the kit's base, with the asking installer, and the .desktop file named for its appId", () => {
    const built = config(PKG, { build: { ...BUILD, nsis: { artifactName: "App-Setup-${version}.${ext}" } } });
    assert.deepEqual(built, {
        ...BUILD,
        extends: KIT_BASE,
        nsis: {
            artifactName: "App-Setup-${version}.${ext}",
            oneClick: false,
            perMachine: false,
            allowElevation: true,
            createDesktopShortcut: true,
            createStartMenuShortcut: true,
            include: built.nsis.include,
        },
        extraMetadata: { desktopName: "com.diamonddigitaldev.app.desktop" },
        linux: { icon: "src/app.png", category: "AudioVideo", syncDesktopName: true },
    });
    // Written outside the app, so it's never packed or committed, and named for what's in it.
    assert.equal(path.dirname(built.nsis.include), INSTALLER_DIR);
    assert.match(path.basename(built.nsis.include), /^installer-[0-9a-f]{16}\.nsh$/);
    assert.equal(config(PKG, { build: BUILD }).nsis.include, built.nsis.include);
    assert.ok(fs.readFileSync(built.nsis.include, "utf8").startsWith("﻿; Made by @diamonddigitaldev/electron-kit's config()"));
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
        // The installer's.
        [[PKG, { build: { ...BUILD, nsis: { include: "installer.nsh" } } }], /build\.nsis\.include is the kit's to set\. The kit's installer asks/],
        [[PKG, { build: { ...BUILD, nsis: { perMachine: true } } }], /build\.nsis\.perMachine is the kit's/],
        [[PKG, { build: { ...BUILD, nsis: { oneClick: true } } }], /build\.nsis\.oneClick is the kit's/],
        [[PKG, { build: { ...BUILD, nsis: { createDesktopShortcut: false } } }], /build\.nsis\.createDesktopShortcut is the kit's/],
        [[PKG, { build: { ...BUILD, nsis: { script: "x.nsi" } } }], /build\.nsis\.script is the kit's/],
        [[PKG, { build: { ...BUILD, productName: 'The "App"' } }], /build\.productName must be/],
        [[PKG, { build: BUILD, contextMenu: "Convert" }], /contextMenu must be \{ label/],
        [[PKG, { build: BUILD, contextMenu: { label: "" } }], /contextMenu\.label must be/],
        [[PKG, { build: BUILD, contextMenu: { label: 'Open "it"' } }], /contextMenu\.label must be/],
        [[PKG, { build: BUILD, contextMenu: { label: "Open", verb: "open" } }], /contextMenu\.verb isn't an option/],
        [[PKG, { build: BUILD, contextMenu: { label: "Open", folders: "yes" } }], /contextMenu\.folders must be/],
        [[PKG, { build: BUILD, contextMenu: { label: "Open", args: ["upload"] } }], /contextMenu\.args must be switches/],
        [[PKG, { build: BUILD, contextMenu: { label: "Open", args: ["--x\" & del"] } }], /contextMenu\.args must be switches/],
        [[PKG, { build: BUILD, fileTypes: Array.from({ length: 5 }, (_, i) => ({ name: `G${i}`, ext: [`txt${i}`], mimeTypes: { [`txt${i}`]: "text/plain" } })) }], /holds 4 columns of 8 file types/],
    ];
    for (const [args, error] of cases) {
        assert.throws(() => config(...args), error, JSON.stringify(args[1]));
    }
    assert.ok(LINUX_CATEGORIES.includes("AudioVideo") && LINUX_CATEGORIES.includes("Network"));
});

/** File Converter's file types, the most an app has. */
const DFC_TYPES = [
    { name: "Audio File", ext: ["mp3", "wav", "flac", "ogg", "aac", "m4a", "opus", "wma"] },
    { name: "Video File", ext: ["mp4", "mkv", "webm", "avi", "mov", "wmv", "flv"] },
    { name: "Image File", ext: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"] },
];

test("the installer: with no file types and no right-click entry, it only upgrades an install for everyone in place", () => {
    const script = installerScript({ productName: "App", fileTypes: [] });
    assert.match(script, /!macro customInstallMode[\s\S]*\$hasPerMachineInstallation == "1"[\s\S]*StrCpy \$isForceMachineInstall "1"/);
    assert.doesNotMatch(script, /customPageAfterChangeDir|customInstall\r\n|WriteRegStr/);
    // Its uninstall still takes the updater's cache.
    assert.match(script, /!macro customUnInstall\r\n  \$\{ifNot\} \$\{isUpdated\}\r\n    !ifdef APP_INSTALLER_STORE_FILE/);
    // The uninstaller is built from it too, and makensis -WX fails on anything it doesn't use.
    assert.match(script, /!ifndef BUILD_UNINSTALLER/);
});

test("the installer: a box per file type in its group's column, all ticked unless an earlier install's choices say not", () => {
    const script = installerScript({ productName: "Diamond File Converter", description: "Converts files", fileTypes: DFC_TYPES, contextMenu: { label: "Convert with Diamond File Converter", folders: true, args: [] } });
    assert.match(script, /MUI_HEADER_TEXT "Choose File Types" "Choose which files Diamond File Converter opens\."/);
    assert.match(script, /It opens them by default only where you haven't already chosen an app/);
    for (const [heading, x] of [["Audio File", 0], ["Video File", 100], ["Image File", 200]]) {
        assert.ok(script.includes(`\${NSD_CreateLabel} ${x}u 28u 96u 9u "${heading}"`), heading);
    }
    const exts = DFC_TYPES.flatMap((group) => group.ext);
    exts.forEach((ext, i) => {
        assert.ok(script.includes(`".${ext}"\r\n    Pop $KitBox${i}`), ext);
        // The last install's choice, else ticked; then /FILETYPES=.
        assert.ok(script.includes(`ReadRegStr $KitType${i} SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" "KitFileType.${ext}"`), ext);
        assert.ok(script.includes(`Push ",${ext},"\r\n    Call KitListHas\r\n    Pop $KitType${i}`), ext);
        // Kept for the next install.
        assert.ok(script.includes(`WriteRegStr SHELL_CONTEXT "\${INSTALL_REGISTRY_KEY}" "KitFileType.${ext}" "$KitType${i}"`), ext);
    });
    assert.match(script, /"Tick All"[\s\S]*"Untick All"/);
    assert.match(script, /"Add \$\\"Convert with Diamond File Converter\$\\" to the menu when you right-click files and folders"/);
    assert.match(script, /\$\{GetOptions\} \$R0 "\/FILETYPES=" \$R1/);
    assert.match(script, /\$\{GetOptions\} \$R0 "\/NOCONTEXTMENU" \$R1/);
    // An update (--updated) never shows it.
    assert.match(script, /Function KitFilesPage\r\n    \$\{if\} \$\{isUpdated\}\r\n      Abort/);
});

test("the installer: a ticked type is in Open With and Default apps, the default only where there's none; an unticked one is taken away", () => {
    const script = installerScript({ productName: "Diamond File Converter", fileTypes: [{ name: "Audio File", ext: ["mp3"] }] });
    const install = script.slice(script.indexOf("!macro customInstall\r\n"), script.indexOf("!macro customUnInstall"));
    const [ticked, unticked] = install.split("  ${else}\r\n");
    assert.match(ticked, /WriteRegStr SHELL_CONTEXT "Software\\Classes\\DiamondFileConverter\.mp3\\shell\\open\\command" "" '"\$appExe" "%1"'/);
    assert.match(ticked, /WriteRegStr SHELL_CONTEXT "Software\\Classes\\\.mp3\\OpenWithProgids" "DiamondFileConverter\.mp3" ""/);
    assert.match(ticked, /WriteRegStr SHELL_CONTEXT "Software\\Diamond Digital Development\\DiamondFileConverter\\Capabilities\\FileAssociations" "\.mp3" "DiamondFileConverter\.mp3"/);
    // The default: only once HKCR has none, or one naming a type no app has.
    assert.match(ticked, /ReadRegStr \$R9 HKCR "\.mp3" ""[\s\S]*EnumRegKey \$R7 HKCR "\$R9" 0[\s\S]*\$\{if\} \$R9 == ""\r\n      WriteRegStr SHELL_CONTEXT "Software\\Classes\\\.mp3" "" "DiamondFileConverter\.mp3"/);
    assert.match(unticked, /DeleteRegValue SHELL_CONTEXT "Software\\Classes\\\.mp3\\OpenWithProgids" "DiamondFileConverter\.mp3"/);
    assert.match(unticked, /\$\{if\} \$R9 == "DiamondFileConverter\.mp3"\r\n      DeleteRegValue SHELL_CONTEXT "Software\\Classes\\\.mp3" ""/);
    assert.match(unticked, /DeleteRegKey SHELL_CONTEXT "Software\\Classes\\DiamondFileConverter\.mp3"/);
    assert.match(install, /WriteRegStr SHELL_CONTEXT "Software\\RegisteredApplications" "Diamond File Converter" "Software\\Diamond Digital Development\\DiamondFileConverter\\Capabilities"/);
    assert.match(install, /SHChangeNotify/);
    // Never written for every user behind the chosen scope's back, and never another app's values.
    assert.doesNotMatch(script, /(WriteRegStr|DeleteRegKey|DeleteRegValue) HKCR/);
    assert.doesNotMatch(script, /DeleteRegKey \/ifempty SHELL_CONTEXT "Software\\Classes/);
});

test("the installer: uninstalling takes everything away, but not when an update uninstalls the version before it", () => {
    const script = installerScript({ productName: "App", fileTypes: [{ name: "Text File", ext: ["txt"] }], contextMenu: { label: "Open with App", folders: true } });
    const uninstall = script.slice(script.indexOf("!macro customUnInstall"));
    assert.match(uninstall, /^!macro customUnInstall\r\n  \$\{ifNot\} \$\{isUpdated\}\r\n/);
    for (const removed of [
        'DeleteRegKey SHELL_CONTEXT "Software\\Classes\\App.txt"',
        'DeleteRegValue SHELL_CONTEXT "Software\\RegisteredApplications" "App"',
        'DeleteRegKey SHELL_CONTEXT "Software\\Diamond Digital Development\\App"',
        'DeleteRegKey SHELL_CONTEXT "Software\\Classes\\*\\shell\\App"',
        'DeleteRegKey SHELL_CONTEXT "Software\\Classes\\Directory\\shell\\App"',
    ]) {
        assert.ok(uninstall.includes(removed), removed);
    }
    // The updater's cache, in the person's own app data, and only a folder named for it.
    assert.match(uninstall, /SetShellVarContext current[\s\S]*\$\{GetParent\} "\$LOCALAPPDATA\\\$\{APP_INSTALLER_STORE_FILE\}" \$R0[\s\S]*\$\{if\} \$R1 == "-updater"\r\n        RMDir \/r "\$R0"[\s\S]*SetShellVarContext all[\s\S]*  \$\{endIf\}\r\n!macroend/);
});

test("the installer: an app that takes any file asks only about its right-click entry, on files, with its switches", () => {
    const script = installerScript({ productName: "Dropgate Client", fileTypes: [], contextMenu: { label: "Share with Dropgate", folders: false, args: ["--upload"] } });
    assert.match(script, /MUI_HEADER_TEXT "Right-Click Menu"/);
    assert.doesNotMatch(script, /Choose File Types|KitListHas|KitType|FILETYPES|RegisteredApplications|Directory\\shell/);
    assert.match(script, /WriteRegStr SHELL_CONTEXT "Software\\Classes\\\*\\shell\\DropgateClient\\command" "" '"\$appExe" "%1" --upload'/);
    assert.match(script, /WriteRegStr SHELL_CONTEXT "Software\\Classes\\\*\\shell\\DropgateClient" "MultiSelectModel" "Player"/);
    assert.match(script, /"Add \$\\"Share with Dropgate\$\\" to the menu when you right-click files"/);
});

test("the installer: text from the app is kept as text in NSIS's strings", () => {
    assert.equal(nsisString('Say "hi" for $5\nnow `x`'), 'Say $\\"hi$\\" for $$5 now $\\`x$\\`');
    const script = installerScript({ productName: "R&D $App", fileTypes: [{ name: "Notes & Text", ext: ["txt"] }] });
    assert.match(script, /"Notes && Text"/);
    assert.match(script, /Choose which files R&D \$\$App opens\./);
    // Its registry keys keep letters and numbers only.
    assert.match(script, /Software\\Classes\\RDApp\.txt/);
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

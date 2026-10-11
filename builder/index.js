"use strict";

// config(): an app's whole electron-builder config, built on the kit's base
// (base.json), from the app's own build options and the files it opens.
//
// An app keeps it in electron-builder.cjs, beside package.json, in place of
// package.json's build (.cjs: on Windows, `electron-builder` typed in a folder
// holding electron-builder.js runs that file with Windows Script Host):
//
//     const { config } = require("@diamonddigitaldev/electron-kit/builder");
//     module.exports = config(require("./package.json"), {
//         build: { appId, productName, artifactName, publish, win, linux: { icon, category }, nsis, ... },
//         fileTypes: [{ name: "Audio File", ext: ["mp3", "wav"] }],
//         contextMenu: { label: "Convert with App", folders: true },
//     });
//
// One list of file types gives each platform what it can do with it. On
// Windows, the asking installer (installer.js) offers each type, the
// shortcuts and the right-click entry, with a box ticked for each, and adds
// only what stays ticked; it asks whether to install for one person or
// everyone. Its sidebar is made from the app's icon (build.linux.icon) in its
// accent (sidebar.js). On
// Linux, the .desktop file lists their MIME types, with %F, so the app is in
// the file manager's Open With for each and gets every file it's opened with;
// desktopName names the .desktop file and the running window after the
// app's appId, so the dock matches the two. An app that takes any file sets
// allFiles instead.
//
// The kit owns the app's file associations and its installer's questions:
// electron-builder's own (fileAssociations) claim every type on Windows
// without asking, so an app never sets them.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MIME_TYPES, ALL_FILES } = require("./mime");
const { installerScript, MAX_LABEL } = require("./installer");
const { sidebarBmp, readPng, logoColour } = require("./sidebar");
const { readAccent } = require("../testing/accent");
const { parseColor } = require("../testing/contrast");

/** What an app's config extends: the kit's base config, by the package's name. */
const KIT_BASE = "@diamonddigitaldev/electron-kit/builder/base.json";

/** freedesktop.org's main categories: the .desktop file's Categories needs one, which puts the app in a menu. */
const LINUX_CATEGORIES = Object.freeze(["AudioVideo", "Audio", "Video", "Development", "Education", "Game", "Graphics", "Network", "Office", "Science", "Settings", "System", "Utility"]);

/** What config() takes beside build. */
const OPTIONS = Object.freeze(["build", "fileTypes", "allFiles", "contextMenu", "sidebar"]);

/** The keys of build the kit sets from fileTypes, so an app never sets them itself. */
const KIT_OWNED = Object.freeze({
    "build.extends": (b) => b.extends,
    "build.fileAssociations": (b) => b.fileAssociations,
    "build.win.fileAssociations": (b) => b.win?.fileAssociations,
    "build.linux.fileAssociations": (b) => b.linux?.fileAssociations,
    "build.linux.mimeTypes": (b) => b.linux?.mimeTypes,
    "build.linux.executableArgs": (b) => b.linux?.executableArgs,
    "build.linux.syncDesktopName": (b) => b.linux?.syncDesktopName,
    "build.linux.desktop": (b) => b.linux?.desktop,
    "build.extraMetadata.desktopName": (b) => b.extraMetadata?.desktopName,
    "build.nsis.include": (b) => b.nsis?.include,
    "build.nsis.script": (b) => b.nsis?.script,
    "build.nsis.oneClick": (b) => b.nsis?.oneClick,
    "build.nsis.perMachine": (b) => b.nsis?.perMachine,
    "build.nsis.allowElevation": (b) => b.nsis?.allowElevation,
    "build.nsis.createDesktopShortcut": (b) => b.nsis?.createDesktopShortcut,
    "build.nsis.createStartMenuShortcut": (b) => b.nsis?.createStartMenuShortcut,
    // The uninstaller's welcome page asks whether to remove the app's data.
    "build.nsis.removeDefaultUninstallWelcomePage": (b) => b.nsis?.removeDefaultUninstallWelcomePage,
    "build.nsis.deleteAppDataOnUninstall": (b) => b.nsis?.deleteAppDataOnUninstall,
    // The sidebar is made from the app's icon and colour.
    "build.nsis.installerSidebar": (b) => b.nsis?.installerSidebar,
    "build.nsis.uninstallerSidebar": (b) => b.nsis?.uninstallerSidebar,
});

/** What each key the kit owns is for, in config()'s refusal. */
function ownedReason(key) {
    if (key === "build.extends") return "config() extends the kit's base config itself.";
    if (key.endsWith("Sidebar")) return "The kit makes the sidebar from build.linux.icon in the app's accent; sidebar: { colour } chooses another colour.";
    if (key.startsWith("build.nsis.")) return "The kit's installer asks who it's for, what it adds and which shortcuts it makes, and its uninstaller whether to remove settings and logs.";
    return "Give the files the app opens as fileTypes (or allFiles).";
}

/**
 * Where config() writes the installer's include and sidebar: outside the app,
 * so they're never packed or committed.
 */
const INSTALLER_DIR = path.join(os.tmpdir(), "diamonddigitaldev-electron-kit");

/**
 * The folder config() writes to: INSTALLER_DIR when it's the running user's
 * own and can be written to, else a new folder of the user's own beside it.
 * On Linux, /tmp is shared: a folder another user made there (root, in a
 * container) never stops a build, and nothing is written into one.
 * @param {string} [dir]
 * @returns {string}
 */
function outputDir(dir = INSTALLER_DIR) {
    try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const stat = fs.lstatSync(dir);
        const ours = stat.isDirectory() && (typeof process.getuid !== "function" || stat.uid === process.getuid());
        if (ours) {
            // A file written and removed: on Windows, only trying it shows the folder can be written to.
            const probe = path.join(dir, `.probe-${process.pid}`);
            fs.writeFileSync(probe, "");
            fs.rmSync(probe);
            return dir;
        }
    } catch {
        // Not ours, or not writable: a folder of our own instead.
    }
    return fs.mkdtempSync(`${dir}-`);
}

/**
 * Check the app's right-click entry: its label, whether it's on folders too,
 * and the switches after the file.
 * @param {unknown} contextMenu
 */
function checkContextMenu(contextMenu) {
    if (contextMenu === null || typeof contextMenu !== "object" || Array.isArray(contextMenu)) {
        throw new Error("config(): contextMenu must be { label, folders?, args? }, such as { label: \"Convert with App\" }.");
    }
    for (const key of Object.keys(contextMenu)) {
        if (!["label", "folders", "args"].includes(key)) throw new Error(`config(): contextMenu.${key} isn't an option. It takes label, folders and args.`);
    }
    if (typeof contextMenu.label !== "string" || contextMenu.label.trim() === "" || /["\r\n]/.test(contextMenu.label)) {
        throw new Error("config(): contextMenu.label must be the entry's text, such as \"Convert with App\", on one line, without quotes.");
    }
    if (contextMenu.label.length > MAX_LABEL) {
        throw new Error(`config(): contextMenu.label is ${contextMenu.label.length} characters; the installer's line holds ${MAX_LABEL}. Shorten it, such as "Convert with App".`);
    }
    if (contextMenu.folders !== undefined && typeof contextMenu.folders !== "boolean") throw new Error("config(): contextMenu.folders must be true or false.");
    if (contextMenu.args !== undefined && (!Array.isArray(contextMenu.args) || !contextMenu.args.every((arg) => typeof arg === "string" && /^--[a-z0-9][a-z0-9-]*(=[A-Za-z0-9._-]+)?$/.test(arg)))) {
        throw new Error("config(): contextMenu.args must be switches, such as [\"--upload\"].");
    }
    return { label: contextMenu.label, folders: contextMenu.folders === true, args: [...(contextMenu.args ?? [])] };
}

/**
 * The app's folder: where the package.json given to config() was required
 * from, or else where electron-builder runs (its own default). So the app's
 * electron-builder.cjs gives the same config wherever it's required from.
 * @param {Record<string, any>} pkg
 */
function appDir(pkg) {
    const found = Object.values(require.cache).find((module) => module?.exports === pkg && module.filename);
    return found ? path.dirname(found.filename) : process.cwd();
}

/** Write a file into dir, named for what's in it (name-<hash>.ext), and return its path. */
function writeOut(dir, name, ext, contents) {
    const file = path.join(dir, `${name}-${crypto.createHash("sha256").update(contents).digest("hex").slice(0, 16)}.${ext}`);
    fs.writeFileSync(file, contents);
    return file;
}

/** What config()'s sidebar.colour takes. */
const SIDEBAR_COLOURS = "\"accent\" (the default: --accent in src/styles/accent.css), \"logo\" (the icon's most common colour) or a colour, \"#rrggbb\"";

/**
 * The installer's sidebar, as a BMP: build.linux.icon, a PNG, on the app's
 * colour. Paths are from the app's folder.
 * @param {string} dir - the app's folder
 * @param {Record<string, any>} build
 * @param {unknown} sidebar - config()'s sidebar option
 * @returns {Buffer}
 */
function makeSidebar(dir, build, sidebar) {
    if (sidebar !== undefined && (sidebar === null || typeof sidebar !== "object" || Array.isArray(sidebar))) {
        throw new Error(`config(): sidebar must be { colour }, where colour is ${SIDEBAR_COLOURS}.`);
    }
    for (const key of Object.keys(sidebar ?? {})) {
        if (key !== "colour") throw new Error(`config(): sidebar.${key} isn't an option. It takes colour.`);
    }
    const choice = sidebar?.colour ?? "accent";
    if (choice !== "accent" && choice !== "logo" && !(typeof choice === "string" && /^#[0-9a-f]{6}$/i.test(choice))) {
        throw new Error(`config(): sidebar.colour is ${JSON.stringify(choice)}; it's ${SIDEBAR_COLOURS}.`);
    }

    const icon = build.linux?.icon;
    if (typeof icon !== "string" || !/\.png$/i.test(icon)) {
        throw new Error("config(): build.linux.icon must be the app's icon as a PNG, such as \"src/assets/app.png\" (512 × 512): the installer's sidebar is made from it.");
    }
    let png;
    try {
        png = fs.readFileSync(path.resolve(dir, icon));
    } catch (err) {
        throw new Error(`config(): build.linux.icon, ${icon}, can't be read (${err.code ?? err.message}). It's found from the app's folder, ${dir}.`);
    }
    const name = `config(): build.linux.icon, ${icon},`;

    let colour;
    if (choice === "logo") {
        colour = logoColour(readPng(png, name));
        if (!colour) throw new Error(`${name} has no colour to take: it's all white, black or grey. Give sidebar.colour as "accent" or "#rrggbb".`);
    } else if (choice === "accent") {
        const file = path.resolve(dir, "src", "styles", "accent.css");
        if (!fs.existsSync(file)) {
            throw new Error("config(): the installer's sidebar is in the app's --accent, from src/styles/accent.css, which isn't there. Give sidebar: { colour: \"logo\" } or { colour: \"#rrggbb\" } instead.");
        }
        colour = parseColor(readAccent(file)["--accent"]);
    } else {
        colour = parseColor(choice);
    }
    return sidebarBmp(png, colour, name);
}

/**
 * Check the file types an app opens: groups with a name and their extensions,
 * lowercase and without the dot, none twice, each with its MIME types (the
 * kit's, or the group's mimeTypes for one the kit doesn't know).
 * @param {unknown} fileTypes
 * @returns {{ name: string, ext: string[], mimeTypes: Record<string, string[]> }[]}
 */
function checkFileTypes(fileTypes) {
    if (!Array.isArray(fileTypes) || fileTypes.length === 0) {
        throw new Error("config(): fileTypes must be a list of groups, such as [{ name: \"Audio File\", ext: [\"mp3\"] }].");
    }
    const seen = new Set();
    return fileTypes.map((group, i) => {
        const where = `config(): fileTypes[${i}]`;
        if (typeof group?.name !== "string" || group.name.trim() === "") throw new Error(`${where} needs a name, such as "Audio File".`);
        // The installer's tree would hide a branch named "-..." and make "!..." bold.
        if (/^[-!]/.test(group.name)) throw new Error(`${where}: "${group.name}" can't start with - or !.`);
        if (!Array.isArray(group.ext) || group.ext.length === 0) throw new Error(`${where} ("${group.name}") needs ext, a list of extensions.`);
        const extra = group.mimeTypes ?? {};
        if (typeof extra !== "object" || Array.isArray(extra)) throw new Error(`${where}.mimeTypes must map an extension to its MIME types.`);
        const mimeTypes = {};
        for (const ext of group.ext) {
            if (ext === "*") throw new Error(`${where}: an app that takes any file sets allFiles: true, not the extension "*".`);
            if (typeof ext !== "string" || !/^[a-z0-9][a-z0-9+_-]*$/.test(ext)) {
                throw new Error(`${where}: "${ext}" isn't an extension. Give it lowercase, without the dot, such as "mp3".`);
            }
            if (seen.has(ext)) throw new Error(`${where}: "${ext}" is listed twice.`);
            seen.add(ext);
            const types = [].concat(extra[ext] ?? MIME_TYPES[ext] ?? []);
            if (types.length === 0 || !types.every((type) => typeof type === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(type))) {
                throw new Error(`${where}: the kit doesn't know the MIME type of "${ext}". Give it in the group's mimeTypes, such as { "${ext}": "application/x-${ext}" }.`);
            }
            mimeTypes[ext] = types;
        }
        return { name: group.name, ext: [...group.ext], mimeTypes };
    });
}

/**
 * An app's electron-builder config: its own build options on the kit's base,
 * with what the files it opens need on each platform.
 * @param {Record<string, any>} pkg - the app's package.json, parsed. Its build moves here.
 * @param {{
 *   build: Record<string, any>,
 *   fileTypes?: { name: string, ext: string[], mimeTypes?: Record<string, string | string[]> }[],
 *   allFiles?: boolean,
 *   contextMenu?: { label: string, folders?: boolean, args?: string[] },
 *   sidebar?: { colour: string },
 * }} options
 *   build: the app's electron-builder options (appId, productName, publish, linux.category, ...), without extends.
 *   fileTypes: the files it opens, in groups. allFiles: it takes any file instead.
 *   contextMenu: its entry on the menu Explorer shows when a file (and, with folders, a folder) is
 *   right-clicked: its label, and switches given after the file.
 *   sidebar: the colour of the installer's sidebar, made from build.linux.icon: the app's
 *   --accent ("accent", the default), the icon's most common colour ("logo"), or "#rrggbb".
 */
function config(pkg, options) {
    if (pkg === null || typeof pkg !== "object" || typeof pkg.name !== "string") throw new Error("config(): the first argument is the app's package.json: require(\"./package.json\").");
    if (pkg.build !== undefined) {
        throw new Error("config(): package.json still has build, which electron-builder reads before electron-builder.cjs. Move it into config()'s build.");
    }
    if (options === null || typeof options !== "object") throw new Error("config(): the second argument is the app's options: { build, fileTypes }.");
    for (const key of Object.keys(options)) {
        if (!OPTIONS.includes(key)) throw new Error(`config(): "${key}" isn't an option. It takes ${OPTIONS.join(", ")}.`);
    }
    const build = options.build;
    if (build === null || typeof build !== "object" || Array.isArray(build)) throw new Error("config(): build must be the app's electron-builder options.");
    for (const [key, read] of Object.entries(KIT_OWNED)) {
        if (read(build) !== undefined) {
            throw new Error(`config(): ${key} is the kit's to set. ${ownedReason(key)}`);
        }
    }
    if (typeof build.appId !== "string" || !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(build.appId)) {
        throw new Error("config(): build.appId must be the app's ID, such as \"com.diamonddigitaldev.app\".");
    }
    if (!LINUX_CATEGORIES.includes(build.linux?.category)) {
        throw new Error(`config(): build.linux.category must be one of freedesktop.org's main categories: ${LINUX_CATEGORIES.join(", ")}.`);
    }
    if (options.allFiles !== undefined && typeof options.allFiles !== "boolean") throw new Error("config(): allFiles must be true or false.");
    if (options.allFiles && options.fileTypes !== undefined) throw new Error("config(): give fileTypes or allFiles, not both.");
    const fileTypes = options.fileTypes === undefined ? [] : checkFileTypes(options.fileTypes);
    const contextMenu = options.contextMenu === undefined ? undefined : checkContextMenu(options.contextMenu);
    const productName = build.productName ?? pkg.productName ?? pkg.name;
    if (typeof productName !== "string" || !/[A-Za-z0-9]/.test(productName) || /["\r\n]/.test(productName)) {
        throw new Error("config(): build.productName must be the app's name, on one line, without quotes.");
    }

    // The .desktop file is named for it, and Electron gives the running window it (its app_id on
    // Wayland, its WM_CLASS on X11), so the dock knows the two are one app.
    const desktopName = `${build.appId}.desktop`;
    if (pkg.desktopName !== undefined && pkg.desktopName !== desktopName) {
        throw new Error(`config(): package.json's desktopName must be "${desktopName}", from build.appId, or left out.`);
    }

    const mimeTypes = options.allFiles ? [ALL_FILES] : [...new Set(fileTypes.flatMap((group) => Object.values(group.mimeTypes).flat()))];
    const linux = { ...build.linux, syncDesktopName: true };
    if (mimeTypes.length > 0) {
        linux.mimeTypes = mimeTypes;
        // Every file it's opened with, as paths. %U, electron-builder's default, can hand over URIs.
        linux.executableArgs = ["%F"];
    }

    const sidebar = makeSidebar(appDir(pkg), build, options.sidebar);
    const dir = outputDir();
    // With a byte-order mark, so makensis reads an app's name in any language as UTF-8.
    const include = writeOut(dir, "installer", "nsh", "\ufeff" + installerScript({ productName, description: pkg.description, fileTypes, contextMenu }));
    const sidebarFile = writeOut(dir, "sidebar", "bmp", sidebar);

    return {
        ...build,
        extends: KIT_BASE,
        // The asking installer: who it's for, then the files it opens and its right-click entry.
        nsis: {
            ...build.nsis,
            oneClick: false,
            perMachine: false,
            allowElevation: true,
            createDesktopShortcut: true,
            createStartMenuShortcut: true,
            include,
            // Beside the welcome and finish pages, the installer's and the uninstaller's.
            installerSidebar: sidebarFile,
            uninstallerSidebar: sidebarFile,
        },
        // Written into the packaged package.json, where Electron reads it.
        extraMetadata: { ...build.extraMetadata, desktopName },
        linux,
    };
}

module.exports = { config, outputDir, KIT_BASE, LINUX_CATEGORIES, MIME_TYPES, ALL_FILES, INSTALLER_DIR };

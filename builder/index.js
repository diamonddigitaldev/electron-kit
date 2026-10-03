"use strict";

// config(): an app's whole electron-builder config, built on the kit's base
// (base.json), from the app's own build options and the files it opens.
//
// An app keeps it in electron-builder.js, beside package.json, in place of
// package.json's build:
//
//     const { config } = require("@diamonddigitaldev/electron-kit/builder");
//     module.exports = config(require("./package.json"), {
//         build: { appId, productName, artifactName, publish, win, linux: { icon, category }, nsis, ... },
//         fileTypes: [{ name: "Audio File", ext: ["mp3", "wav"] }],
//     });
//
// One list of file types gives each platform what it can do with it. On
// Linux, the .desktop file lists their MIME types, with %F, so the app is in
// the file manager's Open With for each and gets every file it's opened with;
// desktopName names the .desktop file and the running window after the
// app's appId, so the dock matches the two. An app that takes any file sets
// allFiles instead.
//
// The kit owns the app's file associations: electron-builder's own
// (fileAssociations) claim every type on Windows without asking, so an app
// never sets them.

const { MIME_TYPES, ALL_FILES } = require("./mime");

/** What an app's config extends: the kit's base config, by the package's name. */
const KIT_BASE = "@diamonddigitaldev/electron-kit/builder/base.json";

/** freedesktop.org's main categories: the .desktop file's Categories needs one, which puts the app in a menu. */
const LINUX_CATEGORIES = Object.freeze(["AudioVideo", "Audio", "Video", "Development", "Education", "Game", "Graphics", "Network", "Office", "Science", "Settings", "System", "Utility"]);

/** What config() takes beside build. */
const OPTIONS = Object.freeze(["build", "fileTypes", "allFiles"]);

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
});

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
 * }} options
 *   build: the app's electron-builder options (appId, productName, publish, linux.category, ...), without extends.
 *   fileTypes: the files it opens, in groups. allFiles: it takes any file instead.
 */
function config(pkg, options) {
    if (pkg === null || typeof pkg !== "object" || typeof pkg.name !== "string") throw new Error("config(): the first argument is the app's package.json: require(\"./package.json\").");
    if (pkg.build !== undefined) {
        throw new Error("config(): package.json still has build, which electron-builder reads before electron-builder.js. Move it into config()'s build.");
    }
    if (options === null || typeof options !== "object") throw new Error("config(): the second argument is the app's options: { build, fileTypes }.");
    for (const key of Object.keys(options)) {
        if (!OPTIONS.includes(key)) throw new Error(`config(): "${key}" isn't an option. It takes ${OPTIONS.join(", ")}.`);
    }
    const build = options.build;
    if (build === null || typeof build !== "object" || Array.isArray(build)) throw new Error("config(): build must be the app's electron-builder options.");
    for (const [key, read] of Object.entries(KIT_OWNED)) {
        if (read(build) !== undefined) {
            throw new Error(`config(): ${key} is the kit's to set. ${key === "build.extends" ? "config() extends the kit's base config itself." : "Give the files the app opens as fileTypes (or allFiles)."}`);
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

    return {
        ...build,
        extends: KIT_BASE,
        // Written into the packaged package.json, where Electron reads it.
        extraMetadata: { ...build.extraMetadata, desktopName },
        linux,
    };
}

module.exports = { config, KIT_BASE, LINUX_CATEGORIES, MIME_TYPES, ALL_FILES };

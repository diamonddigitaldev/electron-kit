"use strict";

// The app's settings, kept by electron-store under one "settings" key in its
// default file (config.json in the app's userData folder), as File Converter
// keeps them. The page reads them with kitAPI.getSettings() and changes them
// with kitAPI.setSettings(changes), as each change is made: there's no save
// button anywhere.
//
// What's stored is read merged over the defaults: the app's own
// (kit.start({ settings: { defaults } })) and the kit's own keys below. So a
// setting added in a later version appears with its default, and a stored
// value the defaults no longer name, or of the wrong kind, is never handed
// out. A change must name a known setting and keep its kind (a boolean stays
// a boolean), or it's refused and nothing is stored. A setting whose default
// is null has no kind yet: it takes any JSON value.
//
// Some of an app's settings are main's alone (settings: { mainOnly }): the
// page may read them, but a change from the page naming one is refused, so a
// page that went wrong can't point a setting such as a downloads folder
// anywhere. And a setting can have a check of its own (settings: { checks }),
// a function of the value that says whether it's taken: a change it refuses,
// from the page or from main, is refused whole. Reads aren't checked. The
// app's main hears every stored change, and who made it, through
// kit.settings.onChange() (createChangeListeners()).
//
// Migration: an app whose settings change shape between versions gives them a
// version (settings: { version, migrate, obsoleteKeys }). When the file was
// last written by an older version, or by none, migrate(settings, from) is
// handed what's stored and returns what's kept; every setting it drops is
// logged by name, and so is each obsolete key the file still holds outside
// the settings (a store of presets from v1), which is deleted. Then the
// version is stored beside them, as settingsSchema, so it runs once per
// version: an unconditional prune would eat a value a later version wrote, on
// its next launch. It runs as the store is first opened, so nothing reads a
// setting it's about to remove. A file written by a newer version is left as
// it is.

/** The kit's own settings, which every app has. */
const KIT_DEFAULTS = Object.freeze({
    // Whether the nav rail is collapsed: a narrow window is where someone
    // collapses it, and having to do it again at every launch would grate.
    navCollapsed: false,
    // Settings > Update (updater.js): download an update as soon as it's
    // found, and the channel updates come from. The channel is null until the
    // updater first starts, which saves the running build's own channel.
    autoDownloadUpdates: true,
    updateChannel: null,
});

/**
 * The kit's settings an app has with the memory log only (log.js): whether
 * the person keeps the log on disk too, off unless they turn it on (D97).
 */
const MEMORY_LOG_DEFAULTS = Object.freeze({
    keepLogOnDisk: false,
});

/**
 * The kit's settings that take one of a few values only, as a list of them.
 * A stored value that isn't one of them is never handed out (the default is,
 * as for a value of the wrong kind), and a change to one is refused.
 */
const KIT_CHOICES = Object.freeze({
    updateChannel: Object.freeze(["stable", "beta", "alpha"]),
});

/** The key the settings are stored under. */
const STORE_KEY = "settings";

/** The key the settings' version is stored under, beside them (File Converter's own). */
const VERSION_KEY = "settingsSchema";

/** The key the main window's bounds are stored under, beside the settings (File Converter's own). */
const BOUNDS_KEY = "windowBounds";

/** Whether a value is a window's bounds: a width and height, and a position or none. */
const isBounds = (value) => isPlainObject(value)
    && [value.width, value.height].every((n) => Number.isFinite(n) && n > 0)
    && [value.x, value.y].every((n) => n === undefined || Number.isFinite(n));

/** A value's kind: "array", "null", or its typeof. */
const kindOf = (value) => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value);

/** A kind, as a setting's error names it. A setting whose default is null takes any JSON value. */
const KIND_NAMES = { array: "a list", object: "an object", boolean: "true or false", number: "a number", string: "text", null: "a JSON value" };

/** Whether a value is a plain object: {} or made by Object.create(null). */
const isPlainObject = (value) => {
    if (kindOf(value) !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

/**
 * Whether a value survives the store's JSON as itself: a string, a finite
 * number, a boolean, null, or a list or plain object of them. A Date, a Map or
 * NaN would come back as something else (IPC can carry all three).
 * @param {unknown} value
 */
function isJsonValue(value) {
    switch (kindOf(value)) {
        case "string":
        case "boolean":
        case "null":
            return true;
        case "number":
            return Number.isFinite(value);
        case "array":
            return value.every(isJsonValue);
        case "object":
            return isPlainObject(value) && Object.values(value).every(isJsonValue);
        default:
            return false;
    }
}

/**
 * Whether a value may be kept as a setting with this default: a JSON value of
 * the default's kind, or any JSON value if the default is null, which stands
 * for "not chosen yet" (File Converter's concurrency: null, the CPU count,
 * until someone picks a number).
 * @param {unknown} value
 * @param {unknown} fallback - The setting's default.
 */
const fits = (value, fallback) => isJsonValue(value) && (fallback === null || kindOf(value) === kindOf(fallback));

/**
 * Whether a value may be kept as this setting: it fits its default, and is
 * one of the setting's choices if it has any (KIT_CHOICES).
 * @param {string} key
 * @param {unknown} value
 * @param {unknown} fallback - The setting's default.
 */
const allowed = (key, value, fallback) => fits(value, fallback) && (!Object.hasOwn(KIT_CHOICES, key) || KIT_CHOICES[key].includes(value));

/**
 * Check the app's defaults: a plain object of JSON values, without the kit's
 * own keys. Throws on anything else, when kit.start() is called.
 * @param {Record<string, unknown>} defaults
 */
function checkDefaults(defaults) {
    if (!isPlainObject(defaults)) throw new Error("kit.start(): settings.defaults must be a plain object.");
    for (const [key, value] of Object.entries(defaults)) {
        if (Object.hasOwn(KIT_DEFAULTS, key) || Object.hasOwn(MEMORY_LOG_DEFAULTS, key)) throw new Error(`kit.start(): "${key}" is one of the kit's own settings; leave it out of settings.defaults.`);
        if (!isJsonValue(value)) throw new Error(`kit.start(): settings.defaults.${key} must be a JSON value.`);
    }
}

/**
 * Check the settings only main changes, and the app's checks: each names one
 * of the app's own settings (a key of its defaults), and each check is a
 * function. Throws on anything else, when kit.start() is called.
 * @param {Record<string, unknown>} defaults - Already checked.
 * @param {string[]} mainOnly
 * @param {Record<string, (value: unknown) => boolean>} checks
 */
function checkRules(defaults, mainOnly, checks) {
    /** Throws unless a key, named in an option, is one of the app's own settings. */
    const ownSetting = (option, key) => {
        if (Object.hasOwn(KIT_DEFAULTS, key) || Object.hasOwn(MEMORY_LOG_DEFAULTS, key)) throw new Error(`kit.start(): settings.${option} names "${key}", one of the kit's own settings; it takes the app's own only.`);
        if (!Object.hasOwn(defaults, key)) throw new Error(`kit.start(): settings.${option} names "${key}", which isn't in settings.defaults.`);
    };
    if (!Array.isArray(mainOnly) || !mainOnly.every((key) => typeof key === "string")) throw new Error("kit.start(): settings.mainOnly must be a list of the app's own settings, by name.");
    for (const key of mainOnly) ownSetting("mainOnly", key);
    if (!isPlainObject(checks)) throw new Error("kit.start(): settings.checks must be an object of functions, by setting.");
    for (const [key, check] of Object.entries(checks)) {
        ownSetting("checks", key);
        if (typeof check !== "function") throw new Error(`kit.start(): settings.checks.${key} must be a function.`);
    }
}

/**
 * Check the migration's options: a version (a whole number from 1), a migrate
 * function, and the obsolete keys (names other than the settings' own). All
 * optional, but migrate and obsoleteKeys need a version.
 */
function checkMigration({ version, migrate, obsoleteKeys = [] }) {
    if (version === undefined) {
        if (migrate !== undefined || obsoleteKeys.length > 0) throw new Error("kit.start(): settings.migrate and settings.obsoleteKeys need a settings.version.");
        return;
    }
    if (!Number.isInteger(version) || version < 1) throw new Error("kit.start(): settings.version must be a whole number, from 1.");
    if (migrate !== undefined && typeof migrate !== "function") throw new Error("kit.start(): settings.migrate must be a function.");
    const kept = [STORE_KEY, VERSION_KEY, BOUNDS_KEY];
    if (!Array.isArray(obsoleteKeys) || !obsoleteKeys.every((key) => typeof key === "string" && key !== "" && !kept.includes(key))) {
        throw new Error(`kit.start(): settings.obsoleteKeys must be a list of the store's other keys (not ${kept.map((k) => `"${k}"`).join(", ")}).`);
    }
}

/**
 * Bring the store up to the settings' version, once (the top of this file).
 * @param {{ get(key: string): unknown, set(key: string, value: unknown): void, delete(key: string): void }} store
 * @param {{ version?: number, migrate?: (settings: object, from: number) => object, obsoleteKeys?: string[], log?: { info(...args: unknown[]): void } }} options
 */
function migrateStore(store, { version, migrate, obsoleteKeys = [], log }) {
    if (version === undefined) return;
    const from = store.get(VERSION_KEY);
    const was = Number.isInteger(from) ? from : 0;
    if (was >= version) return;

    if (migrate) {
        const before = store.get(STORE_KEY);
        const settings = isPlainObject(before) ? before : {};
        const after = migrate(structuredClone(settings), was);
        if (!isPlainObject(after)) throw new Error("settings.migrate() must return the settings to keep, as an object.");
        const removed = Object.keys(settings).filter((key) => !Object.hasOwn(after, key));
        if (removed.length > 0) log?.info(`Settings version ${version}: removing ${removed.join(", ")}.`);
        if (JSON.stringify(after) !== JSON.stringify(settings)) store.set(STORE_KEY, after);
    }
    for (const key of obsoleteKeys) {
        if (store.get(key) !== undefined) {
            log?.info(`Settings version ${version}: removing the store's obsolete key ${key}.`);
            store.delete(key);
        }
    }
    store.set(VERSION_KEY, version);
}

/**
 * The app's settings.
 * @param {{
 *   defaults?: Record<string, unknown>,
 *   mainOnly?: string[],
 *   checks?: Record<string, (value: unknown) => boolean>,
 *   version?: number,
 *   migrate?: (settings: object, from: number) => object,
 *   obsoleteKeys?: string[],
 *   log?: { info(...args: unknown[]): void },
 *   memoryLog?: boolean,
 *   open?: () => { get(key: string): unknown, set(key: string, value: unknown): void, delete(key: string): void },
 * }} [options]
 *   defaults: the app's own settings and their defaults. mainOnly: those
 *   the page may not change. checks: a function per setting, true for a
 *   value it takes. version, migrate and obsoleteKeys: the migration (the
 *   top of this file); log: where it says what it removed. memoryLog: the
 *   app keeps the memory log, so it has keepLogOnDisk too. open: opens the
 *   store, electron-store unless a test stands one in. It's opened on first
 *   use, never before, and migrated then.
 */
function createSettings({ defaults = {}, mainOnly = [], checks = {}, version, migrate, obsoleteKeys, log, memoryLog = false, open = openElectronStore } = {}) {
    checkDefaults(defaults);
    checkRules(defaults, mainOnly, checks);
    checkMigration({ version, migrate, obsoleteKeys });
    const pageCantChange = new Set(mainOnly);
    const checked = { ...checks };
    const all = Object.freeze({ ...defaults, ...KIT_DEFAULTS, ...(memoryLog ? MEMORY_LOG_DEFAULTS : {}) });
    let store = null;
    const stored = () => {
        if (!store) {
            const opened = open();
            // A migration that throws is tried again at the next use, never skipped.
            migrateStore(opened, { version, migrate, obsoleteKeys, log });
            store = opened;
        }
        const value = store.get(STORE_KEY);
        return isPlainObject(value) ? value : {};
    };

    /** Every setting: what's stored, where it's a known setting of the right kind, else its default. */
    function get() {
        const saved = stored();
        const settings = {};
        for (const [key, fallback] of Object.entries(all)) {
            settings[key] = Object.hasOwn(saved, key) && allowed(key, saved[key], fallback) ? saved[key] : fallback;
        }
        return settings;
    }

    /**
     * Change some settings, and return every setting. Refuses the whole change,
     * storing nothing, if it names a setting that doesn't exist, changes a
     * setting's kind, or gives a value the setting's check refuses; or, from
     * the page, if it names a setting only main changes.
     * @param {Record<string, unknown>} changes
     * @param {{ from?: "page" | "main" }} [options] - Who's changing them: main, unless it's the page.
     */
    function set(changes, { from = "main" } = {}) {
        if (!isPlainObject(changes)) throw new Error("Settings can only be changed with an object of settings.");
        for (const [key, value] of Object.entries(changes)) {
            if (!Object.hasOwn(all, key)) throw new Error(`There's no setting called "${key}".`);
            if (from === "page" && pageCantChange.has(key)) throw new Error(`The setting "${key}" can't be changed from the page.`);
            if (Object.hasOwn(KIT_CHOICES, key) && !KIT_CHOICES[key].includes(value)) {
                throw new Error(`The setting "${key}" takes one of ${KIT_CHOICES[key].map((c) => JSON.stringify(c)).join(", ")}.`);
            }
            if (!fits(value, all[key])) throw new Error(`The setting "${key}" takes ${KIND_NAMES[kindOf(all[key])]}.`);
            // A copy, so a check can't change what's stored.
            if (Object.hasOwn(checked, key) && checked[key](structuredClone(value)) !== true) throw new Error(`The setting "${key}" doesn't take that value.`);
        }
        const next = { ...get(), ...changes };
        store.set(STORE_KEY, next);
        return next;
    }

    /**
     * The main window's bounds (windows.js), kept beside the settings in the
     * same file: { x, y, width, height }, or null if none are kept, or what's
     * kept isn't bounds.
     */
    const bounds = {
        get() {
            stored();
            const value = store.get(BOUNDS_KEY);
            return isBounds(value) ? value : null;
        },
        set(value) {
            if (!isBounds(value)) throw new Error("A window's bounds are a width and a height, and an x and a y or neither.");
            stored();
            store.set(BOUNDS_KEY, { ...value });
        },
    };

    return { get, set, defaults: all, bounds };
}

/**
 * The app's listeners for its settings' changes (kit.settings.onChange()).
 * Each stored change is told to every listener, as (changes, after, { from }),
 * each its own copy, in the order they were added. A listener that throws, or
 * returns a promise that rejects, is logged: the change stays stored, and the
 * other listeners still hear it.
 * @param {{ error(...args: unknown[]): void }} log
 */
function createChangeListeners(log) {
    const listeners = new Set();

    /**
     * Listen for every stored change. Returns the function that stops it.
     * @param {(changes: object, after: object, how: { from: "page" | "main" }) => void} listener
     */
    function onChange(listener) {
        if (typeof listener !== "function") throw new Error("kit.settings.onChange() takes a function.");
        // Its own entry, so the same function added twice is two listeners, each stopped on its own.
        const entry = { listener };
        listeners.add(entry);
        return () => {
            listeners.delete(entry);
        };
    }

    /**
     * Tell every listener of a stored change.
     * @param {Record<string, unknown>} changes
     * @param {Record<string, unknown>} after - Every setting, as stored.
     * @param {"page" | "main"} from
     */
    function tell(changes, after, from) {
        const failed = (err) => log.error("A kit.settings.onChange() listener failed:", err);
        // As they are now: one added or stopped by a listener doesn't change who hears this one.
        for (const { listener } of [...listeners]) {
            try {
                const result = listener(structuredClone(changes), structuredClone(after), { from });
                if (typeof result?.then === "function") result.then(undefined, failed);
            } catch (err) {
                failed(err);
            }
        }
    }

    return { onChange, tell };
}

/** electron-store, in its default file. It's ESM only; Node's require() loads it as a namespace. */
function openElectronStore() {
    const Store = require("electron-store").default;
    return new Store();
}

module.exports = { createSettings, createChangeListeners, KIT_DEFAULTS, MEMORY_LOG_DEFAULTS, KIT_CHOICES, STORE_KEY, VERSION_KEY, BOUNDS_KEY };

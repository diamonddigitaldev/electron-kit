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
// Migration between versions of the settings comes with the rest of the store
// (M3).

/** The kit's own settings, which every app has. */
const KIT_DEFAULTS = Object.freeze({
    // Whether the nav rail is collapsed: a narrow window is where someone
    // collapses it, and having to do it again at every launch would grate.
    navCollapsed: false,
});

/** The key the settings are stored under. */
const STORE_KEY = "settings";

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
 * Check the app's defaults: a plain object of JSON values, without the kit's
 * own keys. Throws on anything else, when kit.start() is called.
 * @param {Record<string, unknown>} defaults
 */
function checkDefaults(defaults) {
    if (!isPlainObject(defaults)) throw new Error("kit.start(): settings.defaults must be a plain object.");
    for (const [key, value] of Object.entries(defaults)) {
        if (Object.hasOwn(KIT_DEFAULTS, key)) throw new Error(`kit.start(): "${key}" is one of the kit's own settings; leave it out of settings.defaults.`);
        if (!isJsonValue(value)) throw new Error(`kit.start(): settings.defaults.${key} must be a JSON value.`);
    }
}

/**
 * The app's settings.
 * @param {{ defaults?: Record<string, unknown>, open?: () => { get(key: string): unknown, set(key: string, value: unknown): void } }} [options]
 *   defaults: the app's own settings and their defaults. open: opens the
 *   store, electron-store unless a test stands one in. It's opened on first
 *   use, never before.
 */
function createSettings({ defaults = {}, open = openElectronStore } = {}) {
    checkDefaults(defaults);
    const all = Object.freeze({ ...defaults, ...KIT_DEFAULTS });
    let store = null;
    const stored = () => {
        store ??= open();
        const value = store.get(STORE_KEY);
        return isPlainObject(value) ? value : {};
    };

    /** Every setting: what's stored, where it's a known setting of the right kind, else its default. */
    function get() {
        const saved = stored();
        const settings = {};
        for (const [key, fallback] of Object.entries(all)) {
            settings[key] = Object.hasOwn(saved, key) && fits(saved[key], fallback) ? saved[key] : fallback;
        }
        return settings;
    }

    /**
     * Change some settings, and return every setting. Refuses the whole change,
     * storing nothing, if it names a setting that doesn't exist or changes a
     * setting's kind.
     * @param {Record<string, unknown>} changes
     */
    function set(changes) {
        if (!isPlainObject(changes)) throw new Error("Settings can only be changed with an object of settings.");
        for (const [key, value] of Object.entries(changes)) {
            if (!Object.hasOwn(all, key)) throw new Error(`There's no setting called "${key}".`);
            if (!fits(value, all[key])) throw new Error(`The setting "${key}" takes ${KIND_NAMES[kindOf(all[key])]}.`);
        }
        const next = { ...get(), ...changes };
        store.set(STORE_KEY, next);
        return next;
    }

    return { get, set, defaults: all };
}

/** electron-store, in its default file. It's ESM only; Node's require() loads it as a namespace. */
function openElectronStore() {
    const Store = require("electron-store").default;
    return new Store();
}

module.exports = { createSettings, KIT_DEFAULTS, STORE_KEY };

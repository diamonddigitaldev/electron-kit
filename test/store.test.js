"use strict";

// The settings (main/store.js): kept under one "settings" key, read merged
// over the app's defaults and the kit's own, changed a few at a time, and
// never taking a setting that doesn't exist or a value of the wrong kind. And
// settings:get / settings:set, which kit.start() answers with them.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSettings, KIT_DEFAULTS, KIT_CHOICES, STORE_KEY, VERSION_KEY } = require("../main/store");
const { loadMain, appPage } = require("./helpers/main");
const { INVOKE } = require("../main/channels");

/** A store in memory: `data` is what's on disk. */
function memoryStore(data = {}) {
    let opened = 0;
    return {
        data,
        opened: () => opened,
        open: () => {
            opened++;
            return {
                get: (key) => structuredClone(data[key]),
                set: (key, value) => {
                    data[key] = structuredClone(value);
                },
                delete: (key) => {
                    delete data[key];
                },
            };
        },
    };
}

const APP_DEFAULTS = { format: "mp3", overwrite: false, quality: 5, recent: [], window: { width: 900 } };

/** The kit's own settings, at their defaults. */
const KIT = { navCollapsed: false, autoDownloadUpdates: true, updateChannel: null };

test("the kit's own settings: the rail expanded, updates downloaded automatically, and no channel chosen yet", () => {
    assert.deepEqual(KIT_DEFAULTS, KIT);
    assert.equal(STORE_KEY, "settings");
});

test("with nothing stored, every setting is its default: the app's and the kit's", () => {
    const store = memoryStore();
    assert.deepEqual(createSettings({ defaults: APP_DEFAULTS, open: store.open }).get(), { ...APP_DEFAULTS, ...KIT });
});

test("what's stored wins over the defaults, and a setting added later appears with its default", () => {
    const store = memoryStore({ settings: { format: "flac", navCollapsed: true } });
    assert.deepEqual(createSettings({ defaults: APP_DEFAULTS, open: store.open }).get(), { ...APP_DEFAULTS, ...KIT, format: "flac", navCollapsed: true });
});

test("a stored setting the defaults no longer name, or of the wrong kind, is never handed out", () => {
    const store = memoryStore({ settings: { format: 3, overwrite: "yes", recent: {}, gone: true, navCollapsed: "true", quality: null } });
    assert.deepEqual(createSettings({ defaults: APP_DEFAULTS, open: store.open }).get(), { ...APP_DEFAULTS, ...KIT });
});

test("a stored file that isn't an object of settings reads as the defaults", () => {
    for (const settings of [undefined, null, "settings", [true], 7]) {
        const store = memoryStore({ settings });
        assert.deepEqual(createSettings({ defaults: APP_DEFAULTS, open: store.open }).get(), { ...APP_DEFAULTS, ...KIT }, String(settings));
    }
});

test("set() changes the settings it's given, keeps the rest, stores them all and returns them", () => {
    const store = memoryStore({ settings: { format: "flac" } });
    const settings = createSettings({ defaults: APP_DEFAULTS, open: store.open });
    const after = settings.set({ navCollapsed: true, quality: 9 });
    const expected = { ...APP_DEFAULTS, ...KIT, format: "flac", quality: 9, navCollapsed: true };
    assert.deepEqual(after, expected);
    assert.deepEqual(store.data.settings, expected);
    // A second copy, as at the next launch, reads the same.
    assert.deepEqual(createSettings({ defaults: APP_DEFAULTS, open: store.open }).get(), expected);
});

test("set() refuses a setting that doesn't exist, or a change of kind, and stores nothing", () => {
    const store = memoryStore({ settings: { format: "flac" } });
    const settings = createSettings({ defaults: APP_DEFAULTS, open: store.open });
    const refused = [
        [{ nope: 1 }, /There's no setting called "nope"/],
        [{ navCollapsed: "true" }, /"navCollapsed" takes true or false/],
        [{ navCollapsed: 1 }, /"navCollapsed" takes true or false/],
        [{ recent: {} }, /"recent" takes a list/],
        [{ window: [] }, /"window" takes an object/],
        [{ quality: null }, /"quality" takes a number/],
        [{ quality: Infinity }, /"quality" takes a number/],
        // What IPC can carry and JSON can't keep.
        [{ window: new Map() }, /"window" takes an object/],
        [{ window: { width: new Date() } }, /"window" takes an object/],
        // One bad key refuses the lot, the good one with it.
        [{ format: "wav", nope: 1 }, /no setting called "nope"/],
        // Not an object of settings at all.
        [null, /only be changed with an object/],
        [[{ format: "wav" }], /only be changed with an object/],
        ["format=wav", /only be changed with an object/],
        [undefined, /only be changed with an object/],
    ];
    for (const [changes, error] of refused) {
        assert.throws(() => settings.set(changes), error, JSON.stringify(changes));
    }
    // An own "__proto__" key, as JSON would give, names no setting either.
    assert.throws(() => settings.set(JSON.parse('{"__proto__": {"navCollapsed": true}}')), /no setting called "__proto__"/);
    assert.deepEqual(store.data.settings, { format: "flac" });
    assert.equal(settings.get().navCollapsed, false);
});

test("the update channel is one of stable, beta and alpha, or null until one is saved", () => {
    const store = memoryStore({ settings: { updateChannel: "nightly", autoDownloadUpdates: "yes" } });
    const settings = createSettings({ open: store.open });
    assert.equal(settings.get().updateChannel, null, "a stored channel that isn't one is never handed out");
    assert.equal(settings.get().autoDownloadUpdates, true);
    for (const channel of ["stable", "beta", "alpha"]) assert.equal(settings.set({ updateChannel: channel }).updateChannel, channel);
    for (const channel of ["nightly", "latest", "Stable", null, 1, ["beta"]]) {
        assert.throws(() => settings.set({ updateChannel: channel }), /"updateChannel" takes one of "stable", "beta", "alpha"/, String(channel));
    }
    assert.equal(store.data.settings.updateChannel, "alpha", "a refused change stores nothing");
    assert.throws(() => settings.set({ autoDownloadUpdates: "off" }), /"autoDownloadUpdates" takes true or false/);
    assert.deepEqual(KIT_CHOICES, { updateChannel: ["stable", "beta", "alpha"] });
});

test("the store isn't opened until the settings are first used, and then once", () => {
    const store = memoryStore();
    const settings = createSettings({ defaults: APP_DEFAULTS, open: store.open });
    assert.equal(store.opened(), 0);
    settings.get();
    settings.set({ navCollapsed: true });
    settings.get();
    assert.equal(store.opened(), 1);
});

test("the app's defaults are checked when the settings are made", () => {
    const bad = [
        [[], /must be a plain object/],
        ["defaults", /must be a plain object/],
        [{ navCollapsed: true }, /"navCollapsed" is one of the kit's own settings/],
        [{ updateChannel: "beta" }, /"updateChannel" is one of the kit's own settings/],
        [{ when: new Date() }, /settings\.defaults\.when must be a JSON value/],
        [{ ratio: NaN }, /settings\.defaults\.ratio must be a JSON value/],
        [{ window: { opened: new Map() } }, /settings\.defaults\.window must be a JSON value/],
        [{ run: () => {} }, /settings\.defaults\.run must be a JSON value/],
        [{ missing: undefined }, /settings\.defaults\.missing must be a JSON value/],
    ];
    for (const [defaults, error] of bad) {
        assert.throws(() => createSettings({ defaults, open: memoryStore().open }), error, String(defaults));
    }
    assert.doesNotThrow(() => createSettings({ open: memoryStore().open }));
});

test("kit.start() answers settings:get and settings:set from the store, and hands main the same settings", async () => {
    const { main, handlers, eventFrom, stored, storeCounts } = loadMain({ stored: { settings: { showSample: false } } });
    const kit = main.start({ settings: { defaults: { showSample: true } } });
    const page = eventFrom(appPage());
    assert.equal(storeCounts.opened, 0, "nothing is opened at start");

    assert.deepEqual(await handlers.get(INVOKE.SETTINGS_GET)(page), { showSample: false, ...KIT });
    assert.deepEqual(await handlers.get(INVOKE.SETTINGS_SET)(page, { navCollapsed: true }), { showSample: false, ...KIT, navCollapsed: true });
    assert.deepEqual(stored.settings, { showSample: false, ...KIT, navCollapsed: true });
    assert.deepEqual(kit.settings.get(), { showSample: false, ...KIT, navCollapsed: true });
    assert.throws(() => handlers.get(INVOKE.SETTINGS_SET)(page, { showSample: "no" }), /takes true or false/);
});

test("kit.start() throws on bad settings defaults, before registering anything", () => {
    const { main, handlers } = loadMain();
    assert.throws(() => main.start({ settings: { defaults: { navCollapsed: true } } }), /one of the kit's own settings/);
    assert.equal(handlers.size, 0);
    // And it can still be started properly.
    assert.doesNotThrow(() => main.start());
});

test("a setting whose default is null takes any JSON value, and keeps it across launches", () => {
    // File Converter's concurrency: null until someone picks a number.
    const defaults = { ...APP_DEFAULTS, concurrency: null };
    const store = memoryStore({ settings: { concurrency: 4 } });
    const settings = createSettings({ defaults, open: store.open });
    assert.equal(settings.get().concurrency, 4, "a stored number carries over");
    for (const value of [8, "auto", true, [1, 2], { cores: 2 }, null]) {
        assert.deepEqual(settings.set({ concurrency: value }).concurrency, value, JSON.stringify(value));
        assert.deepEqual(createSettings({ defaults, open: store.open }).get().concurrency, value, `${JSON.stringify(value)}, at the next launch`);
    }
    // Still a JSON value only, stored or changed.
    assert.throws(() => settings.set({ concurrency: NaN }), /"concurrency" takes a JSON value/);
    assert.throws(() => settings.set({ concurrency: new Date() }), /"concurrency" takes a JSON value/);
    assert.deepEqual(createSettings({ defaults, open: memoryStore({ settings: { concurrency: { at: new Date() } } }).open }).get().concurrency, null);
});

// -- Migration --------------------------------------------------------------------

/** A log that records what it's told. */
function recordingLog() {
    const lines = [];
    return { lines, info: (...args) => lines.push(args.join(" ")) };
}

/** File Converter's migration to its version 2: v1's settings 2.0 can't show, pruned. */
const DFC_MIGRATION = {
    version: 2,
    migrate: (settings) => {
        for (const key of ["outputRouting", "outputDir", "nameTemplate", "onConflict"]) delete settings[key];
        return settings;
    },
    obsoleteKeys: ["presets", "pipelines"],
};

test("a store from before the settings' version is migrated once, as it's first opened: what's dropped and each obsolete key are logged", () => {
    const store = memoryStore({
        settings: { onConflict: "unique", outputDir: "C:\out", concurrency: 3 },
        presets: [{ name: "old" }],
        windowBounds: { width: 900, height: 700 },
    });
    const log = recordingLog();
    const settings = createSettings({ defaults: { concurrency: null, onConflict: "ask", outputDir: null }, ...DFC_MIGRATION, log, open: store.open });
    assert.deepEqual(log.lines, [], "nothing until the store is first used");
    assert.deepEqual(settings.get(), { concurrency: 3, onConflict: "ask", outputDir: null, ...KIT });
    assert.deepEqual(store.data, { settings: { concurrency: 3 }, windowBounds: { width: 900, height: 700 }, [VERSION_KEY]: 2 });
    assert.deepEqual(log.lines, [
        "Settings version 2: removing onConflict, outputDir.",
        "Settings version 2: removing the store's obsolete key presets.",
    ]);
    assert.equal(VERSION_KEY, "settingsSchema");

    // Once per version: the same file opened again, with a value written since, keeps it.
    store.data.settings.onConflict = "overwrite";
    const again = recordingLog();
    assert.deepEqual(createSettings({ defaults: { concurrency: null, onConflict: "ask", outputDir: null }, ...DFC_MIGRATION, log: again, open: store.open }).get().onConflict, "overwrite");
    assert.deepEqual(again.lines, []);
});

test("migrate() is told the version the file was at; a new file is at 0, and one from a newer version is left alone", () => {
    const seen = [];
    const options = (version) => ({ version, migrate: (settings, from) => { seen.push(from); return settings; }, open: undefined });
    const fresh = memoryStore();
    createSettings({ ...options(3), open: fresh.open }).get();
    const older = memoryStore({ [VERSION_KEY]: 1, settings: {} });
    createSettings({ ...options(3), open: older.open }).get();
    const newer = memoryStore({ [VERSION_KEY]: 5, settings: { kept: true } });
    createSettings({ defaults: { kept: false }, ...options(3), open: newer.open }).get();
    assert.deepEqual(seen, [0, 1]);
    assert.deepEqual(fresh.data, { [VERSION_KEY]: 3 }, "a new file gets the version, and no settings written for nothing");
    assert.equal(newer.data[VERSION_KEY], 5);
});

test("a migration that throws isn't marked done: it's tried again at the next use", () => {
    const store = memoryStore({ settings: { a: 1 } });
    let fail = true;
    const settings = createSettings({
        defaults: { a: 0 },
        version: 1,
        migrate: (s) => {
            if (fail) throw new Error("not yet");
            return s;
        },
        open: store.open,
    });
    assert.throws(() => settings.get(), /not yet/);
    assert.equal(store.data[VERSION_KEY], undefined);
    fail = false;
    assert.equal(settings.get().a, 1);
    assert.equal(store.data[VERSION_KEY], 1);
});

test("the migration's options are checked when the settings are made", () => {
    const bad = [
        [{ version: 0 }, /settings\.version must be a whole number, from 1/],
        [{ version: 1.5 }, /settings\.version must be a whole number/],
        [{ migrate: (s) => s }, /need a settings\.version/],
        [{ obsoleteKeys: ["presets"] }, /need a settings\.version/],
        [{ version: 1, migrate: "prune" }, /settings\.migrate must be a function/],
        [{ version: 1, obsoleteKeys: ["settings"] }, /obsoleteKeys must be a list of the store's other keys/],
        [{ version: 1, obsoleteKeys: ["settingsSchema"] }, /obsoleteKeys must be a list/],
        [{ version: 1, obsoleteKeys: "presets" }, /obsoleteKeys must be a list/],
    ];
    for (const [options, message] of bad) assert.throws(() => createSettings({ ...options, open: memoryStore().open }), message, JSON.stringify(options));
    const store = memoryStore({ settings: {} });
    assert.throws(() => createSettings({ version: 1, migrate: () => [], open: store.open }).get(), /must return the settings to keep/);
});

test("kit.start() migrates with the app's settings options and logs through the kit's log", () => {
    const { main, stored } = loadMain({ stored: { settings: { outputDir: "x", concurrency: 2 }, pipelines: [] } });
    const kit = main.start({ settings: { defaults: { concurrency: null, outputDir: null }, ...DFC_MIGRATION } });
    assert.deepEqual(kit.settings.get(), { concurrency: 2, outputDir: null, ...KIT });
    assert.deepEqual(stored, { settings: { concurrency: 2 }, settingsSchema: 2 });
});

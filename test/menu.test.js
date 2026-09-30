"use strict";

// The house menu (main/menu.js) and the accelerator rule (main/accelerators.js):
// one "Menu" with the app's items, then Settings on CmdOrCtrl+, and Check for
// Updates, DevTools on pre-releases only, and Exit; and no accelerator Electron
// would take from a text field, which kit.start() refuses and
// electron-kit/testing's assertNoBareAccelerators() fails.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMain } = require("./helpers/main");
const { PUSH } = require("../main/channels");
const { isSafeAccelerator } = require("../main/accelerators");
const { assertNoBareAccelerators } = require("../testing");

const OPEN_FILES = { label: "Open Files", accelerator: "CmdOrCtrl+O", click: () => {} };
const OPEN_FOLDER = { label: "Open Folder", accelerator: "CmdOrCtrl+Shift+O", click: () => {} };

/** A template's items as "label [accelerator]" lines, separators as "—", so its shape reads at a glance. */
const shape = (items) => items.map((item) => (item.type === "separator" ? "—" : `${item.label ?? item.role}${item.accelerator ? ` [${item.accelerator}]` : ""}`));

/** The menu the kit sets once the app is ready, started with this config, for this app version. */
async function menuFor(config, { version = "1.2.3" } = {}) {
    const loaded = loadMain({ version });
    await loaded.main.start(config).ready;
    return { ...loaded, template: loaded.menus.application.template };
}

test("the menu is one top-level Menu: the app's items, Settings and Check for Updates, then Exit", async () => {
    const { template } = await menuFor({ menu: { items: [OPEN_FILES, OPEN_FOLDER] } });
    assert.deepEqual(template.map((item) => item.label), ["Menu"]);
    assert.deepEqual(shape(template[0].submenu), [
        "Open Files [CmdOrCtrl+O]",
        "Open Folder [CmdOrCtrl+Shift+O]",
        "—",
        "Settings [CmdOrCtrl+,]",
        "Check for Updates",
        "—",
        "Exit [Alt+F4]",
    ]);
    assert.equal(template[0].submenu.at(-1).role, "quit");
});

test("with no items of the app's own, the menu starts at Settings", async () => {
    const { template } = await menuFor({});
    assert.deepEqual(shape(template[0].submenu), ["Settings [CmdOrCtrl+,]", "Check for Updates", "—", "Exit [Alt+F4]"]);
});

test("a pre-release has Toggle Developer Tools on F12; a stable release has none", async () => {
    for (const version of ["2.0.0-beta.2", "1.0.0-alpha", "0.1.0-rc.1"]) {
        const { template } = await menuFor({}, { version });
        const devTools = template[0].submenu.find((item) => item.role === "toggleDevTools");
        assert.deepEqual({ label: devTools?.label, accelerator: devTools?.accelerator }, { label: "Toggle Developer Tools", accelerator: "F12" }, version);
        assert.deepEqual(shape(template[0].submenu).slice(-4), ["—", "Toggle Developer Tools [F12]", "—", "Exit [Alt+F4]"], version);
    }
    for (const version of ["2.0.0", "0.0.0", "1.2.3+build.5"]) {
        const { template } = await menuFor({}, { version });
        assert.equal(template[0].submenu.find((item) => item.role === "toggleDevTools"), undefined, version);
    }
});

test("there's no Credits item: Credits is the last tab of Settings", async () => {
    const { template } = await menuFor({ menu: { items: [OPEN_FILES] } }, { version: "2.0.0-beta.2" });
    const labels = JSON.stringify(template, (key, value) => (typeof value === "function" ? undefined : value));
    assert.doesNotMatch(labels, /credits/i);
});

test("Settings and Check for Updates show Settings, and its Update tab, in the window the menu was used in", async () => {
    const { template, openWindow } = await menuFor({});
    const [other, used] = [openWindow(), openWindow()];
    const item = (label) => template[0].submenu.find((i) => i.label === label);

    item("Settings").click(item("Settings"), used);
    item("Check for Updates").click(item("Check for Updates"), used);
    assert.deepEqual(used.sent, [
        { channel: PUSH.VIEW_SHOW, args: [{ view: "settings" }] },
        { channel: PUSH.VIEW_SHOW, args: [{ view: "settings", tab: "update" }] },
    ]);
    assert.deepEqual(other.sent, []);
});

test("with no window given, the menu shows Settings in the focused window, else the first one that's open", async () => {
    const { template, openWindow } = await menuFor({});
    const settings = template[0].submenu.find((i) => i.label === "Settings");
    const gone = openWindow({ destroyed: true });
    const first = openWindow();
    const focused = openWindow({ focused: true });

    settings.click(settings, undefined);
    assert.equal(focused.sent.length, 1);
    focused.focused = false;
    settings.click(settings, undefined);
    assert.deepEqual([gone.sent.length, first.sent.length], [0, 1]);
});

test("on macOS the app's own menu comes first, with Quit in it, so there's no Exit", async () => {
    const { menuTemplate } = require("../main/menu");
    const template = menuTemplate({ items: [OPEN_FILES], version: "1.0.0", platform: "darwin" });
    assert.deepEqual(template.map((item) => item.role ?? item.label), ["appMenu", "Menu"]);
    assert.deepEqual(shape(template[1].submenu), ["Open Files [CmdOrCtrl+O]", "—", "Settings [CmdOrCtrl+,]", "Check for Updates"]);
});

test("kit.start() refuses an app item whose accelerator has no modifier, naming it, before registering anything", () => {
    const bad = [
        { label: "Credits", accelerator: "C" },
        { label: "Preferences", accelerator: "P" },
        { label: "Play", accelerator: "Space" },
        { label: "Remove", accelerator: "Delete" },
        { label: "Shouting", accelerator: "Shift+C" },
        { label: "Nested", submenu: [{ label: "Deep", accelerator: "D" }] },
    ];
    for (const item of bad) {
        const { main, handlers } = loadMain();
        const name = item.submenu ? "Deep" : item.label;
        assert.throws(() => main.start({ menu: { items: [OPEN_FILES, item] } }), new RegExp(`the menu has an accelerator with no modifier[\\s\\S]*"${name}"`), name);
        assert.equal(handlers.size, 0, name);
    }
});

test("kit.start() refuses menu items that aren't a list", () => {
    const { main } = loadMain();
    assert.throws(() => main.start({ menu: { items: OPEN_FILES } }), /menu\.items must be a list/);
});

test("an accelerator is safe with a modifier other than Shift or AltGr, or as a function key alone", () => {
    for (const ok of ["CmdOrCtrl+O", "CommandOrControl+Shift+O", "Ctrl+,", "Alt+F4", "Alt+Enter", "Super+K", "Meta+K", "Option+X", "F1", "F12", "f24", "Shift+F5"]) {
        assert.equal(isSafeAccelerator(ok), true, ok);
    }
    for (const bad of ["C", "P", "Space", "Delete", "Escape", "Shift+C", "AltGr+E", "Shift+AltGr+E", "F25", "F0", "", " ", undefined, 7]) {
        assert.equal(isSafeAccelerator(bad), false, String(bad));
    }
});

test("assertNoBareAccelerators() passes the house menu and fails one with a bare accelerator anywhere, naming each", async () => {
    const { template } = await menuFor({ menu: { items: [OPEN_FILES, OPEN_FOLDER] } }, { version: "2.0.0-beta.1" });
    assert.doesNotThrow(() => assertNoBareAccelerators(template));

    // Media Player's menu before the kit: Preferences on a bare P and Credits on a bare C.
    const theirs = [
        { label: "Menu", submenu: [{ label: "Open File", accelerator: "CmdOrCtrl+O" }, { label: "Full Screen", accelerator: "F11" }] },
        { label: "Preferences", accelerator: "P" },
        { label: "Credits", accelerator: "C" },
    ];
    assert.throws(() => assertNoBareAccelerators(theirs), (err) => {
        assert.equal(err.name, "AssertionError");
        assert.match(err.message, /2 accelerators with no modifier/);
        assert.match(err.message, /"Preferences" has the accelerator "P"/);
        assert.match(err.message, /"Credits" has the accelerator "C"/);
        assert.doesNotMatch(err.message, /Open File|Full Screen/);
        return true;
    });
    assert.throws(() => assertNoBareAccelerators({ label: "Menu" }), TypeError);
});

"use strict";

// The house menu: one top-level entry, "Menu", no Edit, View or Help.
//
//     Menu
//       <the app's own items: Open Files, Open Folder…>
//       ──────────
//       Settings                 CmdOrCtrl+,
//       Check for Updates        (opens Settings > Update)
//       ──────────
//       Toggle Developer Tools   F12        (pre-releases only)
//       ──────────
//       Exit                     Alt+F4
//
// The app passes its own items (kit.start({ menu: { items } })); the kit adds
// the rest. Settings and Check for Updates push view:show to the window, and
// the page's mountShell() shows Settings, and its Update tab for a check, so
// the menu and the rail reach the same place. Check for Updates runs a check
// too (kit.start() passes the updater's check()).
//
// Replacing Electron's default menu takes its F12 with it, and testers need the
// console, so a pre-release (a version with a "-", such as 2.0.0-beta.2)
// declares it; a stable release has none.
//
// On macOS the first menu is always the app's own, with Quit in it, so the kit
// puts Electron's app menu first there and leaves Exit out.
//
// Every accelerator needs a modifier other than Shift, or is a function key
// (accelerators.js): building a menu that breaks the rule throws.

const { BrowserWindow, Menu } = require("electron");
const { bareAccelerators, describeBare } = require("./accelerators");
const { PUSH } = require("./channels");

/** The ids of the kit's own items, for the app's tests and the kit's. */
const MENU_IDS = Object.freeze({
    SETTINGS: "kit-settings",
    CHECK_FOR_UPDATES: "kit-check-for-updates",
    DEVTOOLS: "kit-devtools",
    EXIT: "kit-exit",
});

/** Whether a version is a pre-release: semver's "-" after the numbers. */
const isPrerelease = (version) => /^\d+\.\d+\.\d+-/.test(version);

/**
 * Show a view in a window's page: the window the menu was used in, else the
 * focused one, else the first.
 * @param {Electron.BaseWindow | undefined} win
 * @param {{ view: string, tab?: string }} what
 */
function showView(win, what) {
    const target = [win, BrowserWindow.getFocusedWindow(), ...BrowserWindow.getAllWindows()]
        .find((w) => w && !w.isDestroyed() && w.webContents);
    target?.webContents.send(PUSH.VIEW_SHOW, what);
}

/**
 * The house menu's template, with the app's items in it.
 * @param {{ items?: Electron.MenuItemConstructorOptions[], version: string, platform?: NodeJS.Platform, checkForUpdates?: () => unknown }} options
 *   checkForUpdates: runs a check, after Check for Updates has shown the Update tab.
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function menuTemplate({ items = [], version, platform = process.platform, checkForUpdates = () => {} }) {
    if (!Array.isArray(items)) throw new Error("kit.start(): menu.items must be a list of menu items.");

    const submenu = [
        ...items,
        ...(items.length ? [{ type: "separator" }] : []),
        { id: MENU_IDS.SETTINGS, label: "Settings", accelerator: "CmdOrCtrl+,", click: (_item, win) => showView(win, { view: "settings" }) },
        { id: MENU_IDS.CHECK_FOR_UPDATES, label: "Check for Updates", click: (_item, win) => {
            showView(win, { view: "settings", tab: "update" });
            checkForUpdates();
        } },
        ...(isPrerelease(version)
            ? [{ type: "separator" }, { id: MENU_IDS.DEVTOOLS, label: "Toggle Developer Tools", accelerator: "F12", role: "toggleDevTools" }]
            : []),
        ...(platform === "darwin" ? [] : [{ type: "separator" }, { id: MENU_IDS.EXIT, label: "Exit", accelerator: "Alt+F4", role: "quit" }]),
    ];
    const template = [...(platform === "darwin" ? [{ role: "appMenu" }] : []), { label: "Menu", submenu }];

    const bare = bareAccelerators(template);
    if (bare.length) throw new Error(`kit.start(): the menu has an accelerator with no modifier.\n${describeBare(bare)}`);
    return template;
}

/** Make a template the app's menu. */
function setMenu(template) {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { menuTemplate, setMenu, isPrerelease, MENU_IDS };

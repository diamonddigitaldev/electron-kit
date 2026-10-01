"use strict";

// The app's main window, as File Converter makes it (kit.windows.createMain()):
//
// - the house's secure web preferences, always: sandboxed, isolated, no Node
//   in the page. An app may add its own (its preload), but asking for
//   nodeIntegration, or turning contextIsolation or the sandbox off, throws.
//   Spell checking is off unless asked for (start() gives every session no
//   dictionaries anyway: D28);
// - its size and position kept: saved 500 ms after it's resized or moved, and
//   as it closes, under windowBounds beside the settings (File Converter's own
//   key, so its saved bounds carry over), and put back at the next launch. A
//   position no longer on any screen (a monitor unplugged) is dropped, and the
//   window is centred instead;
// - its icon picked for the platform from one name: name.ico on Windows,
//   name.icns on macOS, name.png on Linux;
// - one main window: asked again while it's open, it's shown and focused.
//
// start() quits the app when its last window closes (bar macOS, where an app
// stays until it's quit), and on macOS makes the main window again when the
// app is activated with none.

const { BrowserWindow, screen } = require("electron");

/** How long after the last resize or move the bounds are saved. */
const SAVE_BOUNDS_DELAY_MS = 500;

/** The web preferences every window of the house has, which an app can't turn off. */
const SECURE = Object.freeze({ sandbox: true, contextIsolation: true, nodeIntegration: false });

/**
 * A window's web preferences: the house's secure ones, spell checking off
 * unless asked for, and the app's own. Throws if the app's would weaken them.
 * @param {Electron.WebPreferences} [own]
 */
function secureWebPreferences(own = {}) {
    if (own.nodeIntegration === true) throw new Error("kit.windows: a window can't have nodeIntegration: the page gets Node through a preload instead.");
    if (own.nodeIntegrationInSubFrames === true || own.nodeIntegrationInWorker === true) throw new Error("kit.windows: a window can't have Node in its frames or workers.");
    if (own.contextIsolation === false) throw new Error("kit.windows: a window can't turn contextIsolation off.");
    if (own.sandbox === false) throw new Error("kit.windows: a window can't turn the sandbox off.");
    if (own.webSecurity === false) throw new Error("kit.windows: a window can't turn webSecurity off.");
    return { spellcheck: false, ...own, ...SECURE };
}

/**
 * The icon for this platform, from its name without an extension.
 * @param {string} name - e.g. path.join(__dirname, "assets", "diamondfileconverter").
 * @param {NodeJS.Platform} [platform]
 */
function iconPath(name, platform = process.platform) {
    return `${name}${platform === "win32" ? ".ico" : platform === "darwin" ? ".icns" : ".png"}`;
}

/**
 * Whether a saved position is still on a screen: its title bar, at least,
 * overlaps one display's work area by a reasonable margin.
 * @param {{ x: number, y: number, width: number }} bounds
 * @param {{ workArea: Electron.Rectangle }[]} displays
 */
function onAScreen({ x, y, width }, displays) {
    const MARGIN = 48;
    return displays.some(({ workArea: a }) => x + width - MARGIN > a.x && x + MARGIN < a.x + a.width && y >= a.y - MARGIN / 2 && y + MARGIN < a.y + a.height);
}

/**
 * Check createMain()'s options.
 * @param {object} options
 */
function checkMain(options) {
    const fail = (message) => {
        throw new Error(`kit.windows.createMain(): ${message}`);
    };
    const { page, size, min, icon, title } = options ?? {};
    if (typeof page !== "string" || page === "") fail("page must be the path of the window's HTML file.");
    const isSize = (value) => value && Number.isInteger(value.width) && Number.isInteger(value.height) && value.width > 0 && value.height > 0;
    if (!isSize(size)) fail("size must be { width, height }, the window's size the first time.");
    if (min !== undefined && !isSize(min)) fail("min must be { width, height }, the smallest it can be made.");
    if (icon !== undefined && (typeof icon !== "string" || icon === "")) fail("icon must be the icon's path without its extension.");
    if (title !== undefined && (typeof title !== "string" || title === "")) fail("title must be the app's name.");
}

/**
 * The windows module, which start() makes.
 * @param {{ bounds: { get(): object | null, set(bounds: object): void }, onMainCreated?: (win: Electron.BrowserWindow) => void }} options
 *   bounds: where the main window's bounds are kept (store.js). onMainCreated:
 *   told about each main window made (instance.js sends it the files).
 */
function createWindows({ bounds, onMainCreated = () => {} }) {
    let main = null;
    let lastOptions = null;

    /**
     * Make the app's main window and load its page, or show the one that's open.
     * @param {{
     *   page: string,
     *   size: { width: number, height: number },
     *   min?: { width: number, height: number },
     *   title?: string,
     *   icon?: string,
     *   webPreferences?: Electron.WebPreferences,
     *   show?: boolean,
     * }} options
     *   page: the HTML file. size: its size the first time. min: the least it
     *   can be made. icon: the icon's path without its extension.
     *   webPreferences: the app's own (its preload), over the house's.
     * @returns {Electron.BrowserWindow}
     */
    function createMain(options) {
        checkMain(options);
        const webPreferences = secureWebPreferences(options.webPreferences);
        if (main && !main.isDestroyed()) {
            if (main.isMinimized()) main.restore();
            main.show();
            main.focus();
            return main;
        }
        lastOptions = options;

        const saved = bounds.get();
        const size = saved ?? options.size;
        const placed = saved && saved.x !== undefined && saved.y !== undefined && onAScreen(saved, screen.getAllDisplays());
        const win = new BrowserWindow({
            width: Math.max(size.width, options.min?.width ?? 0),
            height: Math.max(size.height, options.min?.height ?? 0),
            ...(placed ? { x: saved.x, y: saved.y } : {}),
            ...(options.min ? { minWidth: options.min.width, minHeight: options.min.height } : {}),
            ...(options.title ? { title: options.title } : {}),
            ...(options.icon ? { icon: iconPath(options.icon) } : {}),
            show: options.show ?? true,
            webPreferences,
        });
        main = win;

        // A debounced save, so a drag doesn't write the file at every step.
        let timer = null;
        const save = () => {
            if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized() && !win.isFullScreen()) bounds.set(win.getBounds());
        };
        const saveSoon = () => {
            clearTimeout(timer);
            timer = setTimeout(save, SAVE_BOUNDS_DELAY_MS);
        };
        win.on("resize", saveSoon);
        win.on("move", saveSoon);
        win.on("close", () => {
            clearTimeout(timer);
            save();
        });
        win.on("closed", () => {
            if (main === win) main = null;
        });

        onMainCreated(win);
        win.loadFile(options.page);
        return win;
    }

    return {
        createMain,
        /** The main window, or null when there's none. */
        main: () => (main && !main.isDestroyed() ? main : null),
        /** Make the main window again, as it was last made (macOS's activate). */
        reopen: () => (lastOptions ? createMain(lastOptions) : null),
    };
}

module.exports = { createWindows, secureWebPreferences, iconPath, onAScreen, SECURE, SAVE_BOUNDS_DELAY_MS };

"use strict";

// The demo app, launched as a person would launch it, with a throwaway profile.
//
// Each test gets its own run of demo/ with the demo's own Electron build,
// through Playwright's _electron:
// - with --user-data-dir set to a temporary profile, so it never reads or
//   writes yours (the kit's settings file included); demo.relaunch() quits
//   and launches it again on the same profile, to see what it remembers;
// - without ELECTRON_RUN_AS_NODE, which some shells set, and which makes
//   Electron run as plain Node;
// - with --no-proxy-server. Without it, Electron looks for a proxy by itself
//   when the system says to, as Windows does by default ("Automatically detect
//   settings"), asking the network for a WPAD script;
// - with --log-net-log, so that after the test the run's net log can show it
//   looked up no name beyond this machine. The app's own requests are watched
//   too: it may make none to any server;
// - with Playwright's colour scheme left alone (colorScheme: null). Otherwise
//   it pins every page's prefers-color-scheme to light, so the page would never
//   see the OS theme change. A test switches the theme as the OS does
//   (setOsTheme(), nativeTheme from main) or emulates the media query itself
//   (page.emulateMedia({ colorScheme })).
//
// KIT_DEMO_EXECUTABLE runs a packaged build of the demo instead (the path to
// its executable), so the same tests check the packaged app.
//
// A spec can add switches of its own to every launch with
// test.use({ demoSwitches: [...] }), as the visual spec pins the scale factor,
// and files to open with test.use({ demoFiles: [...] }), after the app, as
// "Open with" passes them. demo.launchSecond(files) launches the demo again on
// the same profile, as a second "Open with" would, and resolves with its exit
// code once it has handed its files over and quit.

const { _electron: electron, test: base, expect } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");
const { spawn } = require("child_process");
const { setTimeout: sleep } = require("timers/promises");
const { netLogSwitches, outsideLookups, proxyLookups } = require("../../testing");

// No trailing separator: on Windows, a backslash before an argument's closing quote escapes it.
const DEMO_DIR = path.join(__dirname, "..", "..", "demo");

/** The packaged demo's executable, when the tests run against a build. */
const PACKAGED = process.env.KIT_DEMO_EXECUTABLE ? path.resolve(process.env.KIT_DEMO_EXECUTABLE) : null;

/** The demo's own Electron build. The electron package downloads it the first time it's asked for. */
const electronPath = () => createRequire(path.join(DEMO_DIR, "package.json"))("electron");

/** Whether a request is to a server, rather than for one of the app's own files. */
const toServer = (url) => /^(https?|wss?):$/.test(new URL(url).protocol);

/** A page is ready once it has shown every check: body[data-ready]. */
const ready = (page) => expect(page.locator("body[data-ready=true]")).toBeAttached({ timeout: 15_000 });

/**
 * Wait until a page is drawn in a theme: the kit's theme.js has stamped it on
 * <html>, and the transitions the switch started have finished.
 * @param {import("@playwright/test").Page} page
 * @param {"dark" | "light"} theme
 */
async function showsTheme(page, theme) {
    await expect(page.locator("html")).toHaveAttribute("data-bs-theme", theme);
    // getAnimations() brings the page's styles up to date first, so it sees the transitions the switch started.
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished)));
}

/** One run of the demo. */
class Demo {
    /** @param {import("@playwright/test").ElectronApplication} app */
    constructor(app) {
        this.app = app;
    }

    /** Whether this run is a packaged build. */
    get packaged() {
        return Boolean(PACKAGED);
    }

    /** The main window, once its page is ready. */
    async mainWindow() {
        const page = await this.app.firstWindow();
        await ready(page);
        return page;
    }

    /** Open the isolated window with the main window's button, and return it once its page is ready. */
    async openIsolatedWindow(main) {
        const [page] = await Promise.all([
            this.app.waitForEvent("window"),
            main.getByRole("button", { name: "Open Isolated Window" }).click(),
        ]);
        await ready(page);
        return page;
    }

    /**
     * What the main process says about a page's window: its web preferences,
     * whether it's in the default session, and the preloads its session has.
     * @param {import("@playwright/test").Page} page
     */
    async windowOf(page) {
        const id = await (await this.app.browserWindow(page)).evaluate((win) => win.id);
        return this.app.evaluate(({ BrowserWindow, session }, id) => {
            const { webContents } = BrowserWindow.fromId(id);
            const prefs = webContents.getLastWebPreferences();
            return {
                sandbox: prefs.sandbox,
                contextIsolation: prefs.contextIsolation,
                nodeIntegration: prefs.nodeIntegration,
                defaultSession: webContents.session === session.defaultSession,
                sessionPreloads: webContents.session.getPreloadScripts(),
            };
        }, id);
    }

    /** The bridges a page's main world has, and what else of Node's it can see. */
    bridgesOf(page) {
        return page.evaluate(() => ({
            kitAPI: typeof window.kitAPI,
            electronAPI: typeof window.electronAPI,
            require: typeof window.require,
            process: typeof window.process,
        }));
    }

    /**
     * Press a key in a page's window as the OS delivers it, through
     * webContents.sendInputEvent(), so a key the page doesn't use goes on to
     * the menu's accelerators. Playwright's keyboard types through DevTools,
     * which marks its keys never to reach the menu.
     * @param {import("@playwright/test").Page} page
     * @param {string} key - One key, as Electron's keyCode names it: ",", "A", "F12".
     * @param {("control" | "shift" | "alt" | "meta")[]} [modifiers]
     */
    async pressKeys(page, key, modifiers = []) {
        const id = await (await this.app.browserWindow(page)).evaluate((win) => win.id);
        await this.app.evaluate(({ BrowserWindow }, { id, key, modifiers }) => {
            const win = BrowserWindow.fromId(id);
            const { webContents } = win;
            // A page that isn't focused drops the keys. On Linux every test's window shares one Xvfb
            // display, and another opening on top takes the focus.
            win.focus();
            webContents.focus();
            webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
            webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
        }, { id, key, modifiers });
    }

    /**
     * Switch the theme as the OS would, from the main process
     * (nativeTheme.themeSource): "dark", "light", or "system" to follow the OS again.
     */
    setOsTheme(theme) {
        return this.app.evaluate(({ nativeTheme }, theme) => {
            nativeTheme.themeSource = theme;
        }, theme);
    }

    /** Switch the OS theme, and wait until a page is drawn in it. */
    async useTheme(page, theme) {
        await this.setOsTheme(theme);
        await showsTheme(page, theme);
    }

    /**
     * Open a window in the app's default session, with the house's secure web
     * preferences but none of the demo's own, showing a URL that isn't one of
     * the demo's pages. The kit's session preload still runs there. With
     * { appPreload: true }, the demo's own preload runs there too, as in a
     * window of the demo's that has been navigated away.
     * @param {string} url
     * @param {{ appPreload?: boolean }} [options]
     */
    async openWindowAt(url, { appPreload = false } = {}) {
        const [page] = await Promise.all([
            this.app.waitForEvent("window"),
            this.app.evaluate(({ BrowserWindow, app }, { url, appPreload }) => {
                const webPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false };
                // The demo's code is at app.getAppPath(): demo/, or app.asar when packaged.
                const sep = process.platform === "win32" ? "\\" : "/";
                if (appPreload) webPreferences.preload = [app.getAppPath(), "src", "preload.js"].join(sep);
                const win = new BrowserWindow({ show: false, webPreferences });
                win.loadURL(url);
            }, { url, appPreload }),
        ]);
        await page.waitForLoadState();
        return page;
    }
}

const test = base.extend({
    demoSwitches: [[], { option: true }],
    demoFiles: [[], { option: true }],
    demoEnv: [{}, { option: true }],
    demo: async ({ demoSwitches, demoFiles, demoEnv }, use) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-demo-"));
        const profile = path.join(root, "profile");
        const env = { ...process.env, ...demoEnv };
        delete env.ELECTRON_RUN_AS_NODE;
        const toServers = [];
        const netLogs = [];

        // A hung app gets 10 s to quit, so the teardown can't hang with it.
        const close = (running) => Promise.race([running.close().catch(() => {}), sleep(10_000)]);

        /** Launch the demo on the test's profile, with a net log of its own. */
        async function launch() {
            const netLog = path.join(root, `netlog-${netLogs.length + 1}.json`);
            netLogs.push(netLog);
            const switches = [`--user-data-dir=${profile}`, ...netLogSwitches(netLog), ...demoSwitches];
            const launched = await electron.launch({
                ...(PACKAGED ? { executablePath: PACKAGED, args: [...switches, ...demoFiles] } : { executablePath: electronPath(), args: [...switches, DEMO_DIR, ...demoFiles] }),
                env,
                colorScheme: null,
            });
            launched.context().on("request", (request) => {
                if (toServer(request.url())) toServers.push(request.url());
            });
            return launched;
        }

        const demo = new Demo(await launch());
        demo.profile = profile;
        /** Launch the demo again on the same profile with these files; it hands them over and quits. */
        demo.launchSecond = (files) => new Promise((resolve, reject) => {
            // On Linux the launch Playwright makes runs without Chromium's SUID sandbox helper, which a plain
            // spawn aborts on ("not configured correctly"), so the second launch is started the same way.
            const switches = [`--user-data-dir=${profile}`, "--no-proxy-server", ...(process.platform === "linux" ? ["--no-sandbox"] : [])];
            const child = PACKAGED
                ? spawn(PACKAGED, [...switches, ...files], { env, stdio: ["ignore", "ignore", "pipe"] })
                : spawn(electronPath(), [...switches, DEMO_DIR, ...files], { env, stdio: ["ignore", "ignore", "pipe"] });
            let stderr = "";
            child.stderr.on("data", (chunk) => (stderr += chunk));
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error("The second launch didn't quit within 15 s."));
            }, 15_000);
            child.on("error", reject);
            child.on("exit", (code, signal) => {
                clearTimeout(timer);
                if (code !== 0) console.error(`The second launch exited with ${code ?? signal}:
${stderr}`);
                resolve(code);
            });
        });
        /** Quit the demo and launch it again on the same profile, as a person would the next day. */
        demo.relaunch = async () => {
            await close(demo.app);
            demo.app = await launch();
        };

        try {
            await use(demo);
            expect.soft(toServers, "requests the demo made to servers").toEqual([]);
            // Quitting finishes the net log.
            await close(demo.app);
            for (const netLog of netLogs) {
                expect.soft(outsideLookups(netLog), `names the demo looked up beyond this machine (${path.basename(netLog)})`).toEqual([]);
                expect.soft(proxyLookups(netLog), `proxy searches the demo made (${path.basename(netLog)})`).toEqual([]);
            }
        } finally {
            await close(demo.app);
            try {
                fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
            } catch (err) {
                // An app that didn't quit can still hold its files. Throwing here would replace the test's own error.
                console.error(`Couldn't remove the test's folder ${root}: ${err.message}`);
            }
        }
    },
});

module.exports = { test, expect, showsTheme };

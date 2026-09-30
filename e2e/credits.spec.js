"use strict";

// Settings > Credits, in real Electron: built from app:get-info, its links and
// buttons opening through shell:open-external. The OS's shell.openExternal is
// stood in for in main, so no browser opens and nothing goes to the network:
// the tests see only what the kit would have handed the OS.

const { test, expect } = require("./helpers/demo");

/** Stand in for shell.openExternal in main: it records each URL, and opens nothing. */
const standInForShell = (demo) => demo.app.evaluate(({ shell }) => {
    globalThis.openedUrls = [];
    shell.openExternal = async (url) => {
        globalThis.openedUrls.push(url);
    };
});

/** What the kit handed shell.openExternal. */
const opened = (demo) => demo.app.evaluate(() => globalThis.openedUrls);

/** Show Settings > Credits, and return its panel. */
async function showCredits(main) {
    await main.getByRole("button", { name: "Settings", exact: true }).click();
    await main.getByRole("tab", { name: "Credits" }).click();
    return main.getByRole("tabpanel", { name: "Credits" });
}

test("Credits shows the app's name and version, its credit lines, and the donate and source buttons, from app:get-info", async ({ demo }) => {
    const main = await demo.mainWindow();
    const credits = await showCredits(main);
    const { name, version } = await demo.app.evaluate(({ app }) => ({ name: app.getName(), version: app.getVersion() }));

    await expect(credits.getByRole("heading", { level: 3 })).toHaveText(`${name} v${version}`);
    // The logo is decoration beside the name, so screen readers skip it.
    await expect(credits.locator("img.credits-logo")).toHaveAttribute("alt", "");
    await expect(credits.locator("p")).toHaveText([
        "• Created and maintained by Diamond Digital Development.",
        "• This demo is licensed under the Apache 2.0 license.",
        "• If you enjoy this software, consider donating to support development!",
    ]);
    await expect(credits.getByRole("link")).toHaveText(["Diamond Digital Development"]);
    await expect(credits.getByRole("button")).toHaveText(["Donate on Buy Me a Coffee", "View Source Code on GitHub"]);
    // The last tab, always.
    await expect(main.getByRole("tab").last()).toHaveText("Credits");
});

test("Credits' link and buttons open through shell:open-external, by mouse and by keyboard, and the window stays put", async ({ demo }) => {
    const main = await demo.mainWindow();
    await standInForShell(demo);
    const credits = await showCredits(main);
    const page = main.url();

    await credits.getByRole("link", { name: "Diamond Digital Development" }).click();
    await credits.getByRole("button", { name: "Donate on Buy Me a Coffee" }).click();
    await credits.getByRole("button", { name: "View Source Code on GitHub" }).click();
    await credits.getByRole("link", { name: "Diamond Digital Development" }).focus();
    await main.keyboard.press("Enter");
    await credits.getByRole("button", { name: "View Source Code on GitHub" }).focus();
    await main.keyboard.press("Space");

    await expect.poll(() => opened(demo)).toEqual([
        "https://diamonddigital.dev",
        "https://buymeacoff.ee/willtda",
        "https://github.com/diamonddigitaldev/electron-kit",
        "https://diamonddigital.dev",
        "https://github.com/diamonddigitaldev/electron-kit",
    ]);
    // The page never followed the link itself, and no window opened.
    expect(main.url()).toBe(page);
    expect(demo.app.windows()).toHaveLength(1);
});

test("a middle click on a credits link opens no window", async ({ demo }) => {
    const main = await demo.mainWindow();
    await standInForShell(demo);
    const credits = await showCredits(main);
    await credits.getByRole("link", { name: "Diamond Digital Development" }).click({ button: "middle" });
    await main.waitForTimeout(300);
    expect(demo.app.windows()).toHaveLength(1);
    expect(await opened(demo)).toEqual([]);
});

test("shell:open-external refuses the app's own page anything but an http(s) link, and opens nothing", async ({ demo }) => {
    const main = await demo.mainWindow();
    await standInForShell(demo);
    const results = await main.evaluate(async () => {
        const urls = ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "ms-settings:privacy", "mailto:someone@example.com", "", null];
        return Promise.all(urls.map((url) => window.kitAPI.openExternal(url).then(() => "opened", (err) => err.message)));
    });
    for (const result of results) expect(result).toMatch(/electron-kit opens http and https links only/);
    expect(await opened(demo)).toEqual([]);
});

"use strict";

// assertAccentContrast() (testing/accent.js): an app's src/styles/accent.css
// is one :root block of the accent's eight properties, and every pairing of
// them with the kit's surfaces meets WCAG 2.2 AA in both themes. The demo's
// accent passes, and so do the three apps' (test/fixtures/accents/).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ACCENT_PROPERTIES, SURFACES, readAccent, accentPairings, accentContrast, assertAccentContrast, over, toHex, parseColor } = require("../testing");

const ROOT = path.join(__dirname, "..");
const DEMO_ACCENT = path.join(ROOT, "demo", "src", "styles", "accent.css");
const APP_ACCENTS = ["file-converter", "media-player", "dropgate"].map((name) => path.join(__dirname, "fixtures", "accents", `${name}.css`));

/** The demo's accent values, to change one at a time. */
const BLUE = {
    "--accent": "#0d6efd",
    "--accent-hover": "#0b5ed7",
    "--accent-rgb": "13, 110, 253",
    "--accent-contrast": "#fff",
    "--accent-text-light": "#0a58ca",
    "--accent-text-dark": "#8bb9fe",
    "--accent-link-light": "#0d6efd",
    "--accent-link-dark": "#6ea8fe",
};

/** Write an accent.css in a temporary folder and return its path. */
function accentFile(t, content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-accent-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "accent.css");
    fs.writeFileSync(file, typeof content === "string" ? content : `:root {\n${Object.entries(content).map(([k, v]) => `    ${k}: ${v};`).join("\n")}\n}\n`);
    return file;
}

test("the demo's accent meets AA in every pairing", () => {
    const results = assertAccentContrast(DEMO_ACCENT);
    assert.equal(results.length, 10);
    assert.ok(results.every((r) => r.pass));
});

test("the demo's accent is Bootstrap's blue with Bootstrap's own link colours", () => {
    assert.deepEqual(readAccent(DEMO_ACCENT), BLUE);
});

for (const file of APP_ACCENTS) {
    test(`${path.basename(file, ".css")}'s accent meets AA in every pairing`, () => {
        assertAccentContrast(file);
    });
}

test("assertAccentContrast() reads src/styles/accent.css by default", (t) => {
    const cwd = process.cwd();
    t.after(() => process.chdir(cwd));
    process.chdir(path.join(ROOT, "demo"));
    assert.equal(assertAccentContrast().length, 10);
});

test("each pairing is the right colours: the theme's shade on Bootstrap's surfaces", () => {
    const byWhat = Object.fromEntries(accentPairings(BLUE).map((p) => [`${p.theme}: ${p.what}`, p]));
    const colours = (p) => [p.foreground.name, toHex(p.background.color), p.min];

    assert.deepEqual(colours(byWhat["light: accent text on the page"]), ["--accent-text-light", "#ffffff", 4.5]);
    assert.deepEqual(colours(byWhat["dark: links on the page"]), ["--accent-link-dark", "#212529", 4.5]);
    assert.deepEqual(colours(byWhat["dark: accent fills on the page (progress, checked boxes, dots)"]), ["--accent", "#212529", 3]);
    assert.deepEqual(colours(byWhat["both: text on the primary button, hovered or pressed"]), ["--accent-contrast", "#0b5ed7", 4.5]);
    // The rail's active item is the rail under kit.css's active wash of the fill.
    const wash = Number(/--wash-active-fill:\s*([\d.]+);/.exec(fs.readFileSync(path.join(ROOT, "css", "kit.css"), "utf8"))[1]);
    assert.equal(wash, 0.06);
    assert.deepEqual(byWhat["dark: accent text on the rail's active item"].background.color, over({ ...parseColor("#0d6efd"), a: wash }, SURFACES.dark.rail));
});

test("the accents before the kit fail, and each failing pairing is named with its ratio", (t) => {
    // File Converter's four values in the new names: its green as text, its muted shade as links.
    const file = accentFile(t, {
        "--accent": "#28a745",
        "--accent-hover": "#34d058",
        "--accent-rgb": "40, 167, 69",
        "--accent-contrast": "#fff",
        "--accent-text-light": "#28a745",
        "--accent-text-dark": "#28a745",
        "--accent-link-light": "#5dd879",
        "--accent-link-dark": "#5dd879",
    });
    assert.throws(() => assertAccentContrast(file), (err) => {
        assert.ok(err instanceof assert.AssertionError);
        const lines = err.message.split("\n");
        assert.equal(lines[0], `6 of 10 accent pairings in ${file} miss WCAG 2.2 AA:`);
        assert.deepEqual(lines.slice(1).map((l) => l.trim()), [
            "light: accent text on the page: --accent-text-light #28a745 on the page #fff is 3.13:1, needs 4.5:1",
            "light: accent text on the rail's active item: --accent-text-light #28a745 on the rail under the active wash #ecf4ef is 2.79:1, needs 4.5:1",
            "light: links on the page: --accent-link-light #5dd879 on the page #fff is 1.81:1, needs 4.5:1",
            "dark: accent text on the rail's active item: --accent-text-dark #28a745 on the rail under the active wash #2b3736 is 3.93:1, needs 4.5:1",
            "both themes: text on the primary button: --accent-contrast #fff on --accent #28a745 is 3.13:1, needs 4.5:1",
            "both themes: text on the primary button, hovered or pressed: --accent-contrast #fff on --accent-hover #34d058 is 2.03:1, needs 4.5:1",
        ]);
        return true;
    });
});

test("a ratio just under AA fails and is never rounded up", (t) => {
    const file = accentFile(t, { ...BLUE, "--accent-link-light": "#046efe" }); // 4.49998:1 on white
    const { failures } = accentContrast(file);
    assert.deepEqual(failures.map((f) => f.what), ["links on the page"]);
    assert.throws(() => assertAccentContrast(file), /#046efe on the page #fff is 4\.49:1, needs 4\.5:1/);
});

test("a UI part needs 3:1, not 4.5:1", (t) => {
    // A fill of 3.4:1 on the light page passes as a fill, while white on it fails as text.
    const file = accentFile(t, { ...BLUE, "--accent": "#3d8bfd", "--accent-rgb": "61, 139, 253" });
    const { failures } = accentContrast(file);
    assert.deepEqual(failures.map((f) => `${f.theme}: ${f.what}`), ["both: text on the primary button"]);
});

test("readAccent() lists the accent's eight properties", () => {
    assert.deepEqual(Object.keys(ACCENT_PROPERTIES), Object.keys(BLUE));
});

test("readAccent() refuses a file that isn't one :root block of the eight properties", async (t) => {
    const without = (name) => Object.fromEntries(Object.entries(BLUE).filter(([k]) => k !== name));
    const block = (body, selector = ":root") => `${selector} {\n${body}\n}\n`;
    const body = Object.entries(BLUE).map(([k, v]) => `    ${k}: ${v};`).join("\n");
    const cases = [
        [without("--accent-link-dark"), /is missing --accent-link-dark/],
        [{ ...without("--accent-text-dark"), "--accent-text-drak": "#8bb9fe" }, /--accent-text-drak isn't one of the accent's properties/],
        [{ ...BLUE, "--radius-card": "4px" }, /--radius-card isn't part of the accent/],
        [block(body, "[data-bs-theme=\"dark\"]"), /one :root block/],
        [`${block(body)}${block("    --accent: #000;")}`, /one :root block/],
        [`@media (prefers-color-scheme: dark) {\n${block(body)}}\n`, /outside a plain rule block/],
        [`${block(body).replace("}", "    --accent: #000;\n}")}`, /sets --accent twice/],
        [{ ...BLUE, "--accent-link-light": "rgba(13, 110, 253, 0.8)" }, /--accent-link-light is .* see-through/],
        [{ ...BLUE, "--accent-contrast": "white" }, /--accent-contrast: "white" isn't a colour/],
        [{ ...BLUE, "--accent-rgb": "13, 110, 252" }, /--accent-rgb is 13, 110, 252, which is #0d6efc, but --accent is #0d6efd/],
        [{ ...BLUE, "--accent-rgb": "#0d6efd" }, /--accent-rgb is #0d6efd; it's written as r, g, b/],
        [{ ...BLUE, "--accent-hover": "11, 94, 215" }, /--accent-hover is 11, 94, 215; only --accent-rgb/],
        [block("    --accent #0d6efd;"), /isn't a declaration/],
    ];
    for (const [content, expected] of cases) {
        const file = accentFile(t, content);
        assert.throws(() => readAccent(file), expected, typeof content === "string" ? content : JSON.stringify(content));
    }
});

test("comments in accent.css are ignored", (t) => {
    const file = accentFile(t, `/* The accent. */\n:root {\n${Object.entries(BLUE).map(([k, v]) => `    ${k}: ${v}; /* ${k} */`).join("\n")}\n}\n`);
    assert.deepEqual(readAccent(file), BLUE);
});

test("the surfaces are Bootstrap's page and tertiary backgrounds in each theme", () => {
    const css = fs.readFileSync(require.resolve("bootstrap/dist/css/bootstrap.css"), "utf8");
    const blockOf = (selector) => {
        const start = css.indexOf(`${selector} {`);
        assert.ok(start >= 0, `Bootstrap's CSS has a ${selector} block`);
        return css.slice(start, css.indexOf("}", start));
    };
    const tokenIn = (block, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(block)[1].trim();
    const light = blockOf(":root,\n[data-bs-theme=light]");
    const dark = blockOf("[data-bs-theme=dark]");
    assert.deepEqual(SURFACES, {
        light: { page: tokenIn(light, "--bs-body-bg"), rail: tokenIn(light, "--bs-tertiary-bg") },
        dark: { page: tokenIn(dark, "--bs-body-bg"), rail: tokenIn(dark, "--bs-tertiary-bg") },
    });
});

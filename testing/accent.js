"use strict";

// The accent's contrast: every pairing of an app's accent with the surfaces the
// kit puts it on, in both themes, against WCAG 2.2 AA.
//
// An app's src/styles/accent.css is one :root block setting the accent's eight
// custom properties (ACCENT_PROPERTIES) and nothing else. kit.css picks each
// theme's text and link shade from them. assertAccentContrast() reads the file,
// checks it's that shape, and fails, naming each pairing and its ratio, if any
// pairing is under AA: 4.5:1 for text, 3:1 for the parts of a control.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseColor, contrastRatio, over, toHex } = require("./contrast");

/** The accent's custom properties, in accent.css's order, and what each is for. */
const ACCENT_PROPERTIES = Object.freeze({
    "--accent": "the fill: primary buttons, progress, checked boxes",
    "--accent-hover": "the fill, hovered or pressed",
    "--accent-rgb": "--accent as r, g, b, for the washes",
    "--accent-contrast": "text and icons on the fill",
    "--accent-text-light": "accent text, and links on hover, in the light theme",
    "--accent-text-dark": "accent text, and links on hover, in the dark theme",
    "--accent-link-light": "links in the light theme",
    "--accent-link-dark": "links in the dark theme",
});

/** WCAG 2.2 AA's minimum contrast: text (1.4.3), and the parts of a control (1.4.11). */
const AA = Object.freeze({ text: 4.5, ui: 3 });

/**
 * The Bootstrap 5.3 surfaces the kit puts the accent on: the page
 * (--bs-body-bg) and the nav rail (--bs-tertiary-bg), in each theme.
 */
const SURFACES = Object.freeze({
    light: Object.freeze({ page: "#fff", rail: "#f8f9fa" }),
    dark: Object.freeze({ page: "#212529", rail: "#2b3035" }),
});

const KIT_CSS = path.join(__dirname, "..", "css", "kit.css");

/** A token's value in the kit's own kit.css, such as "--wash-active-fill". */
function kitToken(name) {
    const css = fs.readFileSync(KIT_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const found = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css);
    if (!found) throw new Error(`kit.css has no ${name}.`);
    return found[1].trim();
}

/**
 * Read an app's accent.css into { "--accent": "#0d6efd", ... }, checking it's
 * one :root block holding the eight properties, each a colour this helper
 * reads, opaque, with --accent-rgb matching --accent.
 * @param {string} file
 */
function readAccent(file) {
    const fail = (why) => {
        throw new Error(`${file}: ${why}`);
    };
    const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

    const blocks = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)];
    if (css.replace(/([^{}]*)\{([^{}]*)\}/g, "").trim()) {
        fail("has something outside a plain rule block (an at-rule or a stray brace); accent.css is one :root block.");
    }
    if (blocks.length !== 1 || blocks[0][1].trim() !== ":root") {
        fail(`sets its values in ${blocks.map((b) => `"${b[1].trim()}"`).join(", ") || "no block"}; accent.css is one :root block.`);
    }

    const accent = {};
    for (const declaration of blocks[0][2].split(";").map((d) => d.trim()).filter(Boolean)) {
        const colon = declaration.indexOf(":");
        const name = declaration.slice(0, colon).trim();
        const value = declaration.slice(colon + 1).trim();
        if (colon < 0 || !value) fail(`"${declaration}" isn't a declaration.`);
        if (!Object.hasOwn(ACCENT_PROPERTIES, name)) {
            fail(name.startsWith("--accent")
                ? `${name} isn't one of the accent's properties: ${Object.keys(ACCENT_PROPERTIES).join(", ")}.`
                : `${name} isn't part of the accent. accent.css holds the accent and nothing else; the rest belongs in the app's styles.css.`);
        }
        if (Object.hasOwn(accent, name)) fail(`sets ${name} twice.`);
        accent[name] = value;
    }

    const missing = Object.keys(ACCENT_PROPERTIES).filter((name) => !Object.hasOwn(accent, name));
    if (missing.length) fail(`is missing ${missing.join(", ")}.`);

    for (const [name, value] of Object.entries(accent)) {
        let color;
        try {
            color = parseColor(value);
        } catch (err) {
            fail(`${name}: ${err.message}`);
        }
        if (color.a !== 1) fail(`${name} is ${value}, which is see-through: its contrast would depend on what's under it.`);
        const triplet = /^\d/.test(value);
        if (name === "--accent-rgb" && !triplet) fail(`--accent-rgb is ${value}; it's written as r, g, b, such as 13, 110, 253.`);
        if (name !== "--accent-rgb" && triplet) fail(`${name} is ${value}; only --accent-rgb is written as r, g, b.`);
    }
    if (toHex(accent["--accent-rgb"]) !== toHex(accent["--accent"])) {
        fail(`--accent-rgb is ${accent["--accent-rgb"]}, which is ${toHex(accent["--accent-rgb"])}, but --accent is ${accent["--accent"]}.`);
    }
    return accent;
}

/**
 * Every pairing the kit uses the accent in, as { theme, what, foreground,
 * background, min }, where foreground and background are { name, color }.
 * @param {Record<string, string>} accent - from readAccent()
 */
function accentPairings(accent) {
    const wash = Number(kitToken("--wash-active-fill"));
    const value = (name) => ({ name, color: accent[name] });
    const surface = (name, color) => ({ name, color });

    const pairings = [];
    for (const theme of ["light", "dark"]) {
        const { page, rail } = SURFACES[theme];
        const activeRail = over({ ...parseColor(accent["--accent"]), a: wash }, rail);
        const text = value(`--accent-text-${theme}`);
        pairings.push(
            { theme, what: "accent text on the page", foreground: text, background: surface("the page", page), min: AA.text },
            { theme, what: "accent text on the rail's active item", foreground: text, background: surface("the rail under the active wash", activeRail), min: AA.text },
            { theme, what: "links on the page", foreground: value(`--accent-link-${theme}`), background: surface("the page", page), min: AA.text },
            { theme, what: "accent fills on the page (progress, checked boxes, dots)", foreground: value("--accent"), background: surface("the page", page), min: AA.ui },
        );
    }
    pairings.push(
        { theme: "both", what: "text on the primary button", foreground: value("--accent-contrast"), background: value("--accent"), min: AA.text },
        { theme: "both", what: "text on the primary button, hovered or pressed", foreground: value("--accent-contrast"), background: value("--accent-hover"), min: AA.text },
    );
    return pairings;
}

/** A ratio to two places, never rounded up: 4.499 is "4.49", and fails. */
const formatRatio = (ratio) => `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;

/** One result as a line: "light: links on the page: --accent-link-light #5dd879 on the page #fff is 1.81:1, needs 4.5:1". */
function describe({ theme, what, foreground, background, min, ratio }) {
    const side = ({ name, color }) => `${name} ${typeof color === "string" ? color : toHex(color)}`;
    return `${theme === "both" ? "both themes" : theme}: ${what}: ${side(foreground)} on ${side(background)} is ${formatRatio(ratio)}, needs ${min}:1`;
}

/**
 * Read an app's accent.css and measure every pairing.
 * @param {string} file
 * @returns {{ accent: Record<string, string>, results: object[], failures: object[] }}
 */
function accentContrast(file) {
    const accent = readAccent(file);
    const results = accentPairings(accent).map((pairing) => {
        const ratio = contrastRatio(pairing.foreground.color, pairing.background.color);
        return { ...pairing, ratio, pass: ratio >= pairing.min };
    });
    return { accent, results, failures: results.filter((r) => !r.pass) };
}

/**
 * Fail unless every pairing of an app's accent meets WCAG 2.2 AA in both
 * themes. The failure names each pairing under AA, with its ratio.
 * @param {string} [file] - the app's accent.css; src/styles/accent.css by default
 * @returns {object[]} every pairing's result, when all pass
 */
function assertAccentContrast(file = path.join("src", "styles", "accent.css")) {
    const { results, failures } = accentContrast(file);
    if (failures.length) {
        assert.fail(`${failures.length} of ${results.length} accent pairings in ${file} miss WCAG 2.2 AA:\n${failures.map((f) => `  ${describe(f)}`).join("\n")}`);
    }
    return results;
}

module.exports = {
    ACCENT_PROPERTIES,
    AA,
    SURFACES,
    readAccent,
    accentPairings,
    accentContrast,
    assertAccentContrast,
    describe,
};

"use strict";

// WCAG 2.2 contrast: the maths behind assertAccentContrast() (accent.js).
//
// Colours are sRGB, written as CSS writes them: "#rgb", "#rrggbb", "#rrggbbaa",
// "rgb(r, g, b)", "rgba(r, g, b, a)", "rgb(r g b / a)", or the bare "r, g, b"
// of an --*-rgb token. Channels are 0-255 and alpha 0-1.

/** Parse a CSS colour into { r, g, b, a }. Throws on anything else. */
function parseColor(text) {
    if (typeof text === "object" && text !== null) return { a: 1, ...text };
    const value = String(text).trim().toLowerCase();

    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
    if (hex) {
        const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
        const [r, g, b, a = 255] = digits.match(/../g).map((pair) => parseInt(pair, 16));
        return { r, g, b, a: a / 255 };
    }

    const fn = /^rgba?\((.*)\)$/.exec(value);
    const parts = (fn ? fn[1] : value).split(/\s*[,/]\s*|\s+/).filter(Boolean);
    const number = /^(\d+(\.\d*)?|\.\d+)$/;
    const [r, g, b, alpha = "1"] = parts;
    if ((parts.length === 3 || (fn && parts.length === 4))
        && [r, g, b].every((c) => number.test(c) && Number(c) <= 255)
        && (number.test(alpha) ? Number(alpha) <= 1 : /^(\d+(\.\d*)?|\.\d+)%$/.test(alpha) && parseFloat(alpha) <= 100)) {
        return { r: Number(r), g: Number(g), b: Number(b), a: alpha.endsWith("%") ? parseFloat(alpha) / 100 : Number(alpha) };
    }
    throw new Error(`"${text}" isn't a colour this helper reads: use #rrggbb, rgb() or "r, g, b".`);
}

/** WCAG 2.2's relative luminance of an opaque colour: 0 for black, 1 for white. */
function luminance(color) {
    const { r, g, b } = parseColor(color);
    const linear = (channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** A colour with alpha, laid over an opaque one, as the page paints it. */
function over(top, bottom) {
    const t = parseColor(top);
    const b = parseColor(bottom);
    if (b.a !== 1) throw new Error("The colour underneath must be opaque.");
    const mix = (x, y) => x * t.a + y * (1 - t.a);
    return { r: mix(t.r, b.r), g: mix(t.g, b.g), b: mix(t.b, b.b), a: 1 };
}

/**
 * The contrast ratio of two colours, from 1 (none) to 21 (black on white). A
 * foreground with alpha is laid over the background first.
 */
function contrastRatio(foreground, background) {
    const bg = parseColor(background);
    if (bg.a !== 1) throw new Error("The background must be opaque: lay it over its surface with over() first.");
    const fg = over(foreground, bg);
    const [light, dark] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
}

/** An opaque colour as "#rrggbb". */
function toHex(color) {
    const { r, g, b } = parseColor(color);
    return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

module.exports = { parseColor, luminance, over, contrastRatio, toHex };

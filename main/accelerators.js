"use strict";

// The house rule for menu accelerators: every accelerator needs a modifier
// other than Shift, or is a function key.
//
// Electron registers a menu's accelerators for the whole window, whatever
// holds focus, text fields included. A bare "C" once opened a Credits window on
// every "c" typed into a text field, and Shift+C would do the same to every
// capital C. Function keys type nothing, so they may stand alone.
//
// The menu builder (menu.js) refuses a menu that breaks it, and
// electron-kit/testing's assertNoBareAccelerators() fails a test on one. This
// file requires nothing of Electron's, so both can use it.

/** Modifiers that make an accelerator safe: with one held, no text is typed. Shift and AltGr type text. */
const SAFE_MODIFIERS = new Set(["command", "cmd", "control", "ctrl", "commandorcontrol", "cmdorctrl", "alt", "option", "super", "meta"]);

/** F1 to F24. */
const FUNCTION_KEY = /^F([1-9]|1\d|2[0-4])$/i;

/**
 * Whether an accelerator is safe: a function key, or a key with a modifier
 * other than Shift or AltGr.
 * @param {string} accelerator - As Electron takes it: "CmdOrCtrl+Shift+O", "F12".
 * @returns {boolean}
 */
function isSafeAccelerator(accelerator) {
    if (typeof accelerator !== "string" || accelerator.trim() === "") return false;
    const parts = accelerator.split("+").map((part) => part.trim());
    const key = parts.at(-1);
    if (FUNCTION_KEY.test(key)) return true;
    return parts.slice(0, -1).some((part) => SAFE_MODIFIERS.has(part.toLowerCase()));
}

/**
 * Every item in a menu template, submenus included, whose accelerator isn't safe.
 * @param {Electron.MenuItemConstructorOptions[]} template
 * @returns {{ label: string, accelerator: string }[]}
 */
function bareAccelerators(template) {
    const found = [];
    const walk = (items) => {
        for (const item of items ?? []) {
            if (item.accelerator !== undefined && !isSafeAccelerator(item.accelerator)) {
                found.push({ label: item.label ?? item.role ?? "(no label)", accelerator: String(item.accelerator) });
            }
            if (Array.isArray(item.submenu)) walk(item.submenu);
        }
    };
    walk(template);
    return found;
}

/**
 * One line per unsafe accelerator, saying why it's unsafe.
 * @param {{ label: string, accelerator: string }[]} found - bareAccelerators()'s list.
 */
function describeBare(found) {
    return found.map(({ label, accelerator }) => `"${label}" has the accelerator "${accelerator}", which needs a modifier other than Shift (CmdOrCtrl, Alt) or a function key: Electron registers it for the whole window, so it would take that key typed into any text field.`).join("\n");
}

module.exports = { isSafeAccelerator, bareAccelerators, describeBare };

"use strict";

// The shared IPC channels: the ones the kit's preload (window.kitAPI) calls and
// the kit's main process answers. Every name is "domain:action".
//
// preload.js can't require this file (a sandboxed preload may only require
// "electron"), so it inlines the same names. test/preload.test.js checks the two
// lists match.
//
// An app's own channels live in the app's own constants and preload, never here.

const CHANNELS = Object.freeze({
    APP_GET_VERSION: "app:get-version",
});

module.exports = { CHANNELS };

"use strict";

// A local update server, and the real electron-updater pointed at it, run
// under plain Node, so the kit's updater (main/updater.js) is tested against
// the library it drives, not a stand-in for it.
//
// electron-updater takes an app to update in place of Electron's (its
// AppAdapter), and an HTTP client in place of Electron's net module (an
// HttpExecutor), as electron-builder's own tests run it. The server answers
// the channel files electron-builder writes (latest.yml, beta.yml,
// alpha.yml, with "-linux" on Linux) and the installer they name, and records
// every request, with its headers.

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { HttpExecutor, configureRequestOptions, configureRequestUrl } = require("builder-util-runtime");
const { NsisUpdater } = require("electron-updater");

/** electron-updater's HTTP client, on Node's http module. download() is ElectronHttpExecutor's, which the base class leaves out. */
class NodeHttpExecutor extends HttpExecutor {
    createRequest(options, callback) {
        return http.request(options, callback);
    }

    download(url, destination, options) {
        return options.cancellationToken.createPromise((resolve, reject, onCancel) => {
            const requestOptions = { headers: options.headers || undefined };
            configureRequestUrl(url, requestOptions);
            configureRequestOptions(requestOptions);
            this.doDownload(requestOptions, {
                destination,
                options,
                onCancel,
                callback: (error) => (error == null ? resolve(destination) : reject(error)),
                responseHandler: null,
            }, 0);
        });
    }
}

/** An installer's name, as electron-builder names it. */
const installerName = (version) => `Kit-Test-Setup-${version}.exe`;

/** The bytes the server hands out as an installer: anything will do, as long as its sha512 matches. */
const installerBytes = (version) => Buffer.from(`installer for ${version}`);

/**
 * A channel file, as electron-builder writes it, for a version.
 * @param {string} version
 * @param {{ sha512?: string }} [options] - sha512: a wrong one, to fail the download
 */
function channelFile(version, { sha512 } = {}) {
    const bytes = installerBytes(version);
    const hash = sha512 ?? crypto.createHash("sha512").update(bytes).digest("base64");
    const file = installerName(version);
    return [
        `version: ${version}`,
        "files:",
        `  - url: ${file}`,
        `    sha512: ${hash}`,
        `    size: ${bytes.length}`,
        `path: ${file}`,
        `sha512: ${hash}`,
        "releaseDate: '2026-09-30T12:00:00.000Z'",
        "",
    ].join("\n");
}

/**
 * Start an update server.
 * @param {Record<string, string | { version: string, sha512?: string }>} channels
 *   What each channel file holds: { latest: "2.1.0", beta: "2.1.0-beta.1" }.
 *   A channel left out is a 404, as a release without that file would be.
 * @returns {Promise<{ url: string, requests: { file: string, headers: http.IncomingHttpHeaders }[], installers: () => string[], close(): Promise<void> }>}
 */
async function startUpdateServer(channels) {
    const requests = [];
    const byFile = new Map();
    for (const [channel, release] of Object.entries(channels)) {
        const { version, sha512 } = typeof release === "string" ? { version: release } : release;
        byFile.set(`${channel}.yml`, channelFile(version, { sha512 }));
        byFile.set(installerName(version), installerBytes(version));
    }
    const server = http.createServer((req, res) => {
        const file = decodeURIComponent(new URL(req.url, "http://localhost").pathname.slice(1));
        requests.push({ file, headers: req.headers });
        // electron-updater asks for "beta-linux.yml" on Linux, "beta.yml" on Windows.
        const body = byFile.get(file.replace(/-linux\.yml$/, ".yml"));
        if (body === undefined) {
            res.statusCode = 404;
            res.end();
            return;
        }
        res.end(body);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}/`,
        requests,
        /** The channel files asked for, as the Windows names. */
        channelFiles: () => requests.filter((r) => r.file.endsWith(".yml")).map((r) => r.file.replace(/-linux\.yml$/, ".yml")),
        /** The installers downloaded. */
        installers: () => requests.filter((r) => r.file.endsWith(".exe")).map((r) => r.file),
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

/**
 * The real electron-updater, as the running app's autoUpdater, pointed at an
 * update server: the app's version, a throwaway userData folder, and the
 * app-update.yml electron-builder would have packaged, naming the server.
 * @param {{ version: string, url: string }} options
 */
function realAutoUpdater({ version, url }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-updater-"));
    const config = path.join(dir, "app-update.yml");
    fs.writeFileSync(config, `provider: generic\nurl: ${url}\nupdaterCacheDirName: kit-test-updater\n`);
    const quitHandlers = [];
    const app = {
        version,
        name: "Kit Test",
        isPackaged: true,
        appUpdateConfigPath: config,
        userDataPath: dir,
        baseCachePath: dir,
        whenReady: () => Promise.resolve(),
        relaunch() {},
        quit() {},
        onQuit: (handler) => quitHandlers.push(handler),
    };
    const autoUpdater = new NsisUpdater(null, app);
    autoUpdater.httpExecutor = new NodeHttpExecutor();
    autoUpdater.logger = null;
    // The installers here are made up, so there's no blockmap to download differences with.
    autoUpdater.disableDifferentialDownload = true;
    return { autoUpdater, dir, quitHandlers };
}

module.exports = { startUpdateServer, realAutoUpdater, channelFile };

"use strict";

// A local HTTP proxy for the update tests, on this machine only: it forwards
// each request it's sent to the server the request names, marks it on the
// way (x-through-test-proxy, so the server can tell what came through it),
// and records it. Chromium sends a proxy the whole URL ("GET
// http://127.0.0.1:47613/latest.yml"), and never sends loopback through one
// unless the rules say <-loopback>. It forwards to loopback only, and refuses
// CONNECT, so nothing it's sent can leave the machine.

const http = require("http");
const { LOCAL_HOST } = require("../../testing/netlog");

/** The header the proxy adds to every request it forwards. */
const THROUGH = "x-through-test-proxy";

/**
 * Start a proxy.
 * @param {{ port?: number }} [options] - port: a fixed one (a launch's proxy rules name it), else any free one
 * @returns {Promise<{ port: number, rules: string, requests: { url: string, method: string }[], close(): Promise<void> }>}
 *   rules: the proxy as Electron's proxyRules write it
 */
async function startProxy({ port = 0 } = {}) {
    const requests = [];
    const sockets = new Set();
    const server = http.createServer((req, res) => {
        requests.push({ url: req.url, method: req.method });
        let target;
        try {
            target = new URL(req.url);
        } catch {
            target = null;
        }
        if (!target || target.protocol !== "http:" || !LOCAL_HOST.test(target.hostname)) {
            res.statusCode = 403;
            res.end();
            return;
        }
        const upstream = http.request(
            { host: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: req.method, headers: { ...req.headers, [THROUGH]: "1" } },
            (answer) => {
                res.writeHead(answer.statusCode, answer.headers);
                answer.pipe(res);
            },
        );
        upstream.on("error", () => res.destroy());
        // A client that goes (its connections closed) takes the request to the server with it.
        res.on("close", () => upstream.destroy());
        req.pipe(upstream);
    });
    server.on("connect", (req, socket) => {
        requests.push({ url: req.url, method: req.method });
        socket.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n");
    });
    server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => server.once("error", reject).listen(port, "127.0.0.1", resolve));
    const bound = server.address().port;
    return {
        port: bound,
        rules: `http://127.0.0.1:${bound}`,
        requests,
        close: () => new Promise((resolve) => {
            for (const socket of sockets) socket.destroy();
            server.close(resolve);
        }),
    };
}

module.exports = { startProxy, THROUGH };

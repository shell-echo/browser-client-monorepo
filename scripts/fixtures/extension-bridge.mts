import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"

const port = Number(process.argv[2])
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid fixture port")
const html =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bridge fixture</title></head><body><main><h1>Bridge fixture</h1><p id="selection">Selected through the isolated agent</p></main><script type="module" src="/fixture.js"></script></body></html>'
const fixture = `import { createClient, chromeTransport } from "/sdk/client.mts";
window.__bridgeTest = {
  client: null, access: [], values: [],
  async connect(id) {
    this.client?.close(); this.access = []; this.values = [];
    this.client = createClient({ connect: chromeTransport(id), reconnect: true });
    this.client.subscribe("access", value => { this.access = value.capabilities ?? []; });
    await this.client.connect();
  },
  watch() { this.client.subscribe("workspace", value => { this.values.push(value); if (this.values.length > 32) this.values.shift(); }); },
  async flood(id) {
    return await new Promise(resolve => {
      const port = chrome.runtime.connect(id, { name: "browser-client/v1" });
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; clearTimeout(timer); resolve(true); });
      const timer = setTimeout(() => { port.disconnect(); resolve(false); }, 3000);
      for (let index = 0; index < 100; index++) port.postMessage({ v: 1, kind: "subscribe", topic: "access" });
    });
  }
};`
const server = createServer((request, response) => {
  void (async () => {
    const path = new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname
    response.setHeader("Cache-Control", "no-store")
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; object-src 'none'")
    if (path === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8")
      response.end(html)
      return
    }
    if (path === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript; charset=utf-8")
      response.end(fixture)
      return
    }
    if (path === "/favicon.ico") {
      response.writeHead(204)
      response.end()
      return
    }
    if (["/sdk/client.mts", "/sdk/protocol.mts"].includes(path)) {
      const source = await readFile(new URL(`../../packages/extension-sdk/src/${path.slice(5)}`, import.meta.url), "utf8")
      response.setHeader("Content-Type", "text/javascript; charset=utf-8")
      response.end(stripTypeScriptTypes(source, { mode: "strip" }))
      return
    }
    response.writeHead(404)
    response.end("Not found")
  })().catch(() => {
    response.writeHead(500)
    response.end("Fixture failed")
  })
})
server.listen(port, "127.0.0.1", () => console.log(`Bridge fixture ready on ${port}`))
function close() {
  server.close(() => process.exit(0))
}
process.once("SIGTERM", close)
process.once("SIGINT", close)

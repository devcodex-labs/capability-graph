import { startHttpService, type ServiceConfig } from "./service.js";

// Configuration belongs to the deployed application, never inferred from the querying Core.
const config = JSON.parse(process.argv[2] ?? "{}") as ServiceConfig;
const service = await startHttpService(config);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await service.close(); if (process.connected) process.disconnect();
}
process.once("SIGTERM", () => { void stop(); }); process.once("SIGINT", () => { void stop(); });
process.once("disconnect", () => { void stop(); });
process.on("message", (raw: unknown) => {
  const message = raw as { action?: string; id?: number; method?: string; path?: string };
  if (message.action === "close") { void stop(); return; }
  if (message.action === "register") {
    try {
      service.registerRoute(message.method!, message.path!, (_request, response) => {
        response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ registered: true, path: message.path }));
      });
      process.send?.({ id: message.id, ok: true });
    } catch { process.send?.({ id: message.id, ok: false }); }
  }
});
const ready = { ready: true, url: service.url, port: service.port, pid: process.pid, sourceIdentity: service.sourceIdentity };
if (process.send) process.send(ready); else console.log(JSON.stringify(ready));

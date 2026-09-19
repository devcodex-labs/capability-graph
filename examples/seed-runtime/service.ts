import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface ServiceConfig {
  project: string; environment: string; staticRevision: string; buildId: string; port?: number;
}
type Handler = (request: IncomingMessage, response: ServerResponse) => void;
interface Route { method: string; path: string; handler: Handler }
export interface Snapshot {
  providerId: string; project: string; environment: string; sourceIdentity: string; buildId: string;
  staticRevision: string; runtimeRevision: string; observedAt: string;
  routes: { method: string; path: string }[]; nextCursor?: string;
}
const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value));
};

/** The same registry owns HTTP dispatch and Runtime discovery. It is not a fixture snapshot. */
export async function startHttpService(config: ServiceConfig) {
  if (![config.project, config.environment, config.staticRevision, config.buildId].every((value) => typeof value === "string" && !!value.trim())) {
    throw new Error("Explicit project, environment, build and static revision are required");
  }
  const sourceIdentity = `seed-http:${process.pid}:${randomUUID()}`;
  const routes = new Map<string, Route>();
  const registerRoute = (method: string, path: string, handler: Handler) => {
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method) || !/^\/[a-zA-Z0-9/_-]*$/.test(path) || path.startsWith("/__capabilities")) throw new Error("Invalid route");
    const key = `${method} ${path}`;
    if (routes.has(key)) throw new Error("Duplicate route");
    routes.set(key, { method, path, handler });
  };
  registerRoute("POST", "/users", (_request, response) => json(response, 201, { created: true, project: config.project, environment: config.environment }));
  registerRoute("GET", "/users", (_request, response) => json(response, 200, { users: [], project: config.project, environment: config.environment }));
  const server = createServer((request, response) => {
    request.resume();
    let url: URL;
    try { url = new URL(request.url ?? "/", "http://127.0.0.1"); }
    catch { json(response, 400, { error: "invalid_request_target" }); return; }
    if (url.pathname !== "/__capabilities/runtime") {
      const route = routes.get(`${request.method} ${url.pathname}`);
      if (!route) { json(response, 404, { error: "route_not_found" }); return; }
      try { route.handler(request, response); } catch { if (!response.headersSent) json(response, 500, { error: "handler_failed" }); else response.destroy(); }
      return;
    }
    if (request.method !== "GET") { json(response, 405, { error: "read_only" }); return; }
    if (url.searchParams.get("project") !== config.project || url.searchParams.get("environment") !== config.environment) {
      json(response, 409, { error: "source_context_mismatch" }); return;
    }
    try {
      const limit = Number(url.searchParams.get("limit"));
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit");
      const all = [...routes.values()].map(({ method, path }) => ({ method, path })).sort((a, b) =>
        `${a.method} ${a.path}` < `${b.method} ${b.path}` ? -1 : 1);
      const runtimeRevision = `r:${createHash("sha256").update(JSON.stringify({ project: config.project, environment: config.environment,
        sourceIdentity, buildId: config.buildId, staticRevision: config.staticRevision, routes: all })).digest("hex").slice(0, 16)}`;
      const type = url.searchParams.get("instanceOf"); const instance = url.searchParams.get("instanceId");
      const selected = all.filter((route) => (!type || type === "route.http") && (!instance || instance === `${route.method} ${route.path}`));
      const filter = JSON.stringify([config.project, config.environment, type, instance, limit]);
      let offset = 0;
      if (url.searchParams.has("cursor")) {
        const cursor = JSON.parse(Buffer.from(url.searchParams.get("cursor")!, "base64url").toString("utf8")) as { revision: string; offset: number; filter: string };
        if (!cursor || typeof cursor.revision !== "string" || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.filter !== filter) throw new Error("cursor");
        // On a source change return its new revision; Core rejects the old revision-bound cursor.
        if (cursor.revision === runtimeRevision) offset = cursor.offset;
      }
      if (offset > selected.length) throw new Error("cursor");
      const page = selected.slice(offset, offset + limit);
      const nextCursor = offset + page.length < selected.length ? Buffer.from(JSON.stringify({ revision: runtimeRevision, offset: offset + page.length, filter })).toString("base64url") : undefined;
      const snapshot: Snapshot = { providerId: "seed.http", project: config.project, environment: config.environment, sourceIdentity,
        buildId: config.buildId, staticRevision: config.staticRevision, runtimeRevision, observedAt: new Date().toISOString(), routes: page,
        ...(nextCursor === undefined ? {} : { nextCursor }) };
      json(response, 200, snapshot);
    } catch { json(response, 400, { error: "invalid_query" }); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(config.port ?? 0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing listener");
  let closed: Promise<void> | undefined;
  return { url: `http://127.0.0.1:${address.port}`, port: address.port, sourceIdentity, registerRoute,
    close: () => closed ??= new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
    }) };
}

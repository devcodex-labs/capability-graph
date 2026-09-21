import { get } from "node:http";
import type { RuntimeAdapter, RuntimeAdapterResult } from "@devcodex/capability-graph";
import type { Snapshot } from "./service.js";

/** Dedicated local example protocol, not a general remote KnowledgeReader. */
export function readHttpJson(url: URL, timeoutMs: number, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = get(url, { agent: false }, (response) => {
      if (response.statusCode !== 200 || !response.headers["content-type"]?.startsWith("application/json")) {
        reject(new Error("Source response rejected")); response.destroy(); request.destroy(); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { reject(new Error("Source response exceeds budget")); response.destroy(); request.destroy(); }
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown); } catch { reject(new Error("Invalid source JSON")); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error("Source deadline exceeded")), timeoutMs);
    request.on("error", reject); request.on("close", () => clearTimeout(timer));
  });
}

export class HttpRuntimeAdapter implements RuntimeAdapter {
  readonly id = "seed-http-runtime"; readonly providerId = "seed.http";
  private readonly endpoint: URL;
  private readonly timeoutMs: number; private readonly maxBytes: number;
  constructor(options: { endpoint: string; timeoutMs?: number; maxBytes?: number }) {
    this.endpoint = new URL(options.endpoint);
    if (this.endpoint.protocol !== "http:" || this.endpoint.hostname !== "127.0.0.1" || this.endpoint.username || this.endpoint.password ||
      this.endpoint.pathname !== "/__capabilities/runtime" || this.endpoint.search || this.endpoint.hash) throw new Error("Use the explicit loopback Runtime endpoint");
    this.timeoutMs = options.timeoutMs ?? 2000; this.maxBytes = options.maxBytes ?? 262144;
    if (![this.timeoutMs, this.maxBytes].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("Invalid HTTP budgets");
  }
  async query(input: Parameters<RuntimeAdapter["query"]>[0]): Promise<RuntimeAdapterResult> {
    const url = new URL(this.endpoint);
    url.searchParams.set("project", input.project); url.searchParams.set("environment", input.environment); url.searchParams.set("limit", String(input.limit));
    if (input.instanceOf) url.searchParams.set("instanceOf", input.instanceOf.capabilityId);
    if (input.instanceId !== undefined) url.searchParams.set("instanceId", input.instanceId);
    if (input.cursor !== undefined) url.searchParams.set("cursor", input.cursor);
    const raw = await readHttpJson(url, this.timeoutMs, this.maxBytes) as Snapshot;
    if (!raw || raw.providerId !== this.providerId || raw.project !== input.project || raw.environment !== input.environment || !Array.isArray(raw.routes) ||
        [raw.sourceIdentity, raw.buildId, raw.staticRevision, raw.runtimeRevision, raw.observedAt].some((value) => typeof value !== "string" || !value) ||
        raw.routes.some((route) => !route || typeof route.method !== "string" || typeof route.path !== "string")) throw new Error("Source contract mismatch");
    return { instances: raw.routes.map((route) => ({ instanceId: `${route.method} ${route.path}`, providerId: this.providerId,
      project: raw.project, environment: raw.environment, instanceOf: { providerId: this.providerId, capabilityId: "route.http" },
      facts: { method: route.method, path: route.path, buildId: raw.buildId } })),
      observation: { source: "seed-http:registered-routes", sourceIdentity: raw.sourceIdentity, observedAt: raw.observedAt,
        runtimeRevision: raw.runtimeRevision, observedAgainstStaticRevision: raw.staticRevision,
        compatibility: raw.staticRevision === input.currentStaticRevision ? "compatible" : "unknown",
        availability: raw.routes.length ? "available" : "empty", freshness: "current",
        coverage: "Registered application routes of this process; excludes the discovery endpoint and other processes",
        freshnessLimit: "Observed per request; changes after observation require another query" },
      ...(raw.nextCursor === undefined ? {} : { nextCursor: raw.nextCursor }) };
  }
}

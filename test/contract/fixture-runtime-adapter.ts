import type { RuntimeAdapter, RuntimeAdapterResult, RuntimeInstance } from "../../src/runtime/types.js";

export const instance = (instanceId = "route-1", extra: Partial<RuntimeInstance> = {}): RuntimeInstance => ({
  instanceId, providerId: "seed", project: "project-a", environment: "test", instanceOf: { providerId: "seed", capabilityId: "a" }, facts: { method: "POST", path: "/users" }, ...extra,
});
/** Hand-written contract fixture. It is not the real HTTP source or F-18 evidence. */
export class FixtureRuntimeAdapter implements RuntimeAdapter {
  readonly id = "fixture";
  readonly providerId = "seed";
  calls = 0;
  constructor(readonly reply: (input: Parameters<RuntimeAdapter["query"]>[0]) => RuntimeAdapterResult | Promise<RuntimeAdapterResult> = (input) => ({
    instances: [instance()], observation: { source: "fixture://routes", sourceIdentity: "fixture-build", observedAt: new Date().toISOString(),
      runtimeRevision: "r:1", observedAgainstStaticRevision: input.currentStaticRevision, availability: "available", freshness: "current", compatibility: "compatible" },
  })) {}
  async query(input: Parameters<RuntimeAdapter["query"]>[0]) { this.calls++; return this.reply(input); }
}

export function seedRuntimeFixture(): RuntimeAdapter {
  return { id: "fixture-seed", providerId: "seed.http", query: async (input) => ({
    instances: [instance("users.create", { providerId: "seed.http", project: input.project, environment: input.environment,
      instanceOf: { providerId: "seed.http", capabilityId: "route.http" } })],
    observation: { source: "fixture://seed", runtimeRevision: "r:fixture", observedAt: new Date().toISOString(),
      observedAgainstStaticRevision: input.currentStaticRevision, compatibility: "compatible", availability: "available", freshness: "current" },
  }) };
}

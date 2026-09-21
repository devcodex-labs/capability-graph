import assert from "node:assert/strict";
import { test } from "node:test";
import { CapabilityGraphError, equalId, formatQualifiedId, idKey, isId,
  isKnowledgeId, parseQualifiedId } from "@devcodex/capability-graph";
import { bindCapabilityId } from "../src/identity.js";

test("E-20: explicit and bound identities produce the same reversible key", () => {
  const explicit = { providerId: "seed.http", capabilityId: "route.validation" };
  const bound = bindCapabilityId("seed.http", "route.validation");
  assert.deepEqual(bound, explicit);
  assert.equal(equalId(bound, explicit), true);
  assert.equal(idKey(bound), "seed.http::route.validation");
  assert.deepEqual(parseQualifiedId(formatQualifiedId(explicit)), explicit);
  assert.equal(equalId(explicit, { ...explicit, providerId: "seed" }), false);
  assert.notEqual(idKey(explicit), idKey({ providerId: "seed", capabilityId: "http.route.validation" }));
});

test("E-20: ambiguous display strings never infer the first dot as a boundary", () => {
  for (const value of ["vextjs.route.http", "", "::route", "a::b::c"]) {
    assert.throws(() => parseQualifiedId(value), { code: "CG_IDENTITY_AMBIGUOUS", nextAction: "fix_input" });
  }
  for (const value of ["a::", "a:::b", "A::b", "a::b:c", "a::b\n"]) {
    assert.throws(() => parseQualifiedId(value), { code: "CG_IDENTITY_INVALID" });
  }
});

test("identity length, ASCII case, whitespace and knowledge IDs", () => {
  assert.equal(isId("a"), true);
  assert.equal(isId("a".repeat(128)), true);
  for (const value of ["a".repeat(129), "A", "0abc", "a b", "a:b", " a", "a\n", "\u4e2d"]) {
    assert.equal(isId(value), false, JSON.stringify(value));
  }
  assert.equal(isKnowledgeId("D-02"), true);
  assert.equal(isKnowledgeId("D".repeat(128)), true);
  assert.equal(isKnowledgeId("D".repeat(129)), false);
  assert.equal(isKnowledgeId("D-02\n"), false);
  assert.equal(isKnowledgeId("2-D"), false);
});

test("JavaScript callers cannot coerce objects or format invalid keys", () => {
  let coerced = false;
  const object = { toString: () => { coerced = true; return "valid"; } };
  assert.equal(isId(object as never), false);
  assert.equal(coerced, false);
  for (const value of [null, undefined, 0, "a::b", {}, { providerId: "a", capabilityId: "b:c" }]) {
    assert.throws(() => formatQualifiedId(value as never), CapabilityGraphError);
  }
  assert.throws(() => parseQualifiedId(object as never), { code: "CG_IDENTITY_INVALID" });
  assert.throws(() => bindCapabilityId("Bad", "route"), { code: "CG_IDENTITY_INVALID" });
});

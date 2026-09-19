import assert from "node:assert/strict";
import { test } from "node:test";
import { CapabilityGraphError, type BatchItem, type ErrorShape } from "@devcodex-labs/capability-graph";

test("public errors retain code, action, message and projected details", () => {
  const input = { reason: "all_runtime_items_rejected" };
  const error = new CapabilityGraphError("CG_ADAPTER_CONTRACT_INVALID", {
    nextAction: "repair_source", details: input,
  });
  assert.ok(error instanceof Error);
  assert.equal(error.name, "CapabilityGraphError");
  assert.match(error.message, /contract/);
  input.reason = "changed";
  assert.equal(error.details?.reason, "all_runtime_items_rejected");
  const publicError: ErrorShape = { code: error.code, message: error.message,
    nextAction: error.nextAction, details: error.details };
  assert.equal(JSON.parse(JSON.stringify(publicError)).code, error.code);
  assert.equal(Object.hasOwn(publicError, "stack"), false);
});

test("custom messages and absent details remain distinct", () => {
  const error = new CapabilityGraphError("CG_IDENTITY_INVALID", { nextAction: "fix_input", message: "Invalid local ID" });
  assert.equal(error.message, "Invalid local ID");
  assert.equal(error.details, undefined);
  assert.equal(error.code, "CG_IDENTITY_INVALID");
});

test("F-16: batch discriminants retain failed and successful input slots", () => {
  const results: BatchItem<string>[] = [
    { inputIndex: 0, ok: false, error: new CapabilityGraphError("CG_NOT_FOUND", { nextAction: "fix_input" }) },
    { inputIndex: 1, ok: true, value: "route.http" },
  ];
  assert.deepEqual(results.map((item) => item.inputIndex), [0, 1]);
  const first = results[0]!;
  assert.equal(first.ok, false);
  if (!first.ok) assert.equal(first.error.code, "CG_NOT_FOUND");
});

import { CapabilityGraphError } from "./errors.js";
import { isId } from "./identity.js";

export function computeEffectiveScope(input: {
  hostAllowed: readonly string[] | undefined;
  integrationEnabled: readonly string[] | undefined;
  request?: readonly string[] | undefined;
  phase: "open" | "query";
}): { ok: true; scope: ReadonlySet<string> } | { ok: false; error: CapabilityGraphError } {
  if (!Array.isArray(input.hostAllowed) || !Array.isArray(input.integrationEnabled) ||
      [...(input.hostAllowed ?? []), ...(input.integrationEnabled ?? [])].some((id) => !isId(id))) {
    return { ok: false, error: new CapabilityGraphError("CG_CONFIG_INCOMPLETE", { nextAction: "configure_backend" }) };
  }
  let scope = new Set(input.hostAllowed.filter((id) => input.integrationEnabled!.includes(id)));
  if (input.phase === "query" && input.request !== undefined) {
    if (!Array.isArray(input.request) || input.request.some((id) => !isId(id))) {
      return { ok: false, error: new CapabilityGraphError("CG_INPUT_INVALID", { nextAction: "fix_input" }) };
    }
    if (input.request.some((id) => !scope.has(id))) {
      return { ok: false, error: new CapabilityGraphError("CG_SCOPE_DENIED", { nextAction: "narrow_scope" }) };
    }
    scope = new Set(input.request);
  }
  return { ok: true, scope };
}

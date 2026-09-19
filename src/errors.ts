export type NextAction =
  | "fix_input"
  | "narrow_scope"
  | "page_or_filter"
  | "configure_backend"
  | "repair_source"
  | "refresh"
  | "select_capabilities"
  | "use_retrieval"
  | "reduce_document";

export type ErrorCode =
  | "CG_CONFIG_INCOMPLETE"
  | "CG_DUAL_AUTHORITY"
  | "CG_SCOPE_DENIED"
  | "CG_IDENTITY_AMBIGUOUS"
  | "CG_IDENTITY_INVALID"
  | "CG_NOT_FOUND"
  | "CG_VALIDATION_FAILED"
  | "CG_RELATION_CROSS_PROVIDER"
  | "CG_RELATION_CYCLE"
  | "CG_LOAD_FAILED"
  | "CG_NO_ACTIVE_VIEW"
  | "CG_REVISION_MISMATCH"
  | "CG_INDEX_STALE"
  | "CG_INPUT_INVALID"
  | "CG_RUNTIME_CONTEXT_REQUIRED"
  | "CG_RUNTIME_DISABLED"
  | "CG_RUNTIME_UNAVAILABLE"
  | "CG_RUNTIME_RESULT_MISMATCH"
  | "CG_ADAPTER_CONTRACT_INVALID"
  | "CG_KNOWLEDGE_NOT_ASSOCIATED"
  | "CG_KNOWLEDGE_TYPE_UNSUPPORTED"
  | "CG_READER_UNCONFIGURED"
  | "CG_READER_UNAVAILABLE"
  | "CG_RETRIEVER_UNCONFIGURED"
  | "CG_RETRIEVER_UNAVAILABLE"
  | "CG_SOURCE_UNREADABLE"
  | "CG_PATH_TRAVERSAL"
  | "CG_BUDGET_EXCEEDED"
  | "CG_TIMEOUT"
  | "CG_PARTIAL_ITEM";

export interface ErrorShape {
  readonly code: ErrorCode;
  readonly message: string;
  readonly nextAction: NextAction;
  readonly details?: Readonly<Record<string, unknown>>;
}

const messages: Readonly<Record<ErrorCode, string>> = {
  CG_CONFIG_INCOMPLETE: "Configuration is missing or invalid.",
  CG_DUAL_AUTHORITY: "A provider must have exactly one authority.",
  CG_SCOPE_DENIED: "The request is outside the effective provider scope.",
  CG_IDENTITY_AMBIGUOUS: "Capability identity requires unambiguous provider context.",
  CG_IDENTITY_INVALID: "Provider or capability identity is invalid.",
  CG_NOT_FOUND: "The requested item was not found.",
  CG_VALIDATION_FAILED: "The source definition failed validation.",
  CG_RELATION_CROSS_PROVIDER: "Graph relations must stay within one provider.",
  CG_RELATION_CYCLE: "A classification or specialization relation contains a cycle.",
  CG_LOAD_FAILED: "The provider source could not be loaded.",
  CG_NO_ACTIVE_VIEW: "No validated readable view is available.",
  CG_REVISION_MISMATCH: "The requested revision or cursor is no longer readable.",
  CG_INDEX_STALE: "The index does not match its current source identities.",
  CG_INPUT_INVALID: "The query input is invalid.",
  CG_RUNTIME_CONTEXT_REQUIRED: "Runtime queries require project and environment.",
  CG_RUNTIME_DISABLED: "No runtime adapter is enabled for this provider.",
  CG_RUNTIME_UNAVAILABLE: "The runtime source is unavailable.",
  CG_RUNTIME_RESULT_MISMATCH: "A runtime item does not match the requested context.",
  CG_ADAPTER_CONTRACT_INVALID: "The adapter result violates its contract.",
  CG_KNOWLEDGE_NOT_ASSOCIATED: "No knowledge is associated with the selected capability.",
  CG_KNOWLEDGE_TYPE_UNSUPPORTED: "This knowledge type does not support direct reading.",
  CG_READER_UNCONFIGURED: "No reader is configured for this knowledge source.",
  CG_READER_UNAVAILABLE: "The configured knowledge reader is unavailable.",
  CG_RETRIEVER_UNCONFIGURED: "No retriever is configured for this operation.",
  CG_RETRIEVER_UNAVAILABLE: "The configured retriever is unavailable.",
  CG_SOURCE_UNREADABLE: "The requested source cannot be read.",
  CG_PATH_TRAVERSAL: "The source path is outside its allowed boundary.",
  CG_BUDGET_EXCEEDED: "The operation exceeds its configured budget.",
  CG_TIMEOUT: "The operation timed out.",
  CG_PARTIAL_ITEM: "This item could not be returned.",
};

/** Public failure contract. Callers supply only deliberately projected details. */
export class CapabilityGraphError extends Error implements ErrorShape {
  readonly code: ErrorCode;
  readonly nextAction: NextAction;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    init: { nextAction: NextAction; message?: string; details?: Record<string, unknown> },
  ) {
    super(init.message ?? messages[code]);
    this.name = "CapabilityGraphError";
    this.code = code;
    this.nextAction = init.nextAction;
    if (init.details !== undefined) this.details = Object.freeze({ ...init.details });
  }
}

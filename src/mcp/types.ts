/** Ordinary JSON tool metadata; consumers do not need MCP SDK or schema-library types. */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: { readonly readOnlyHint: true; readonly destructiveHint: false;
    readonly idempotentHint: true; readonly openWorldHint: boolean };
}
/** Both representations contain the same complete JSON value. Inspect Core batch slots even when isError is false. */
export interface ToolCallResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent: Readonly<Record<string, unknown>>;
  readonly isError: boolean;
}
export interface ToolkitOptions {
  /** ASCII letters, digits, underscore and hyphen; final names must fit 128 characters. Default capability_graph_. */
  readonly namePrefix?: string;
  /** Subset of graph configuration scope. Omitted inherits it; [] creates a legal empty scope. */
  readonly allowedProviders?: readonly string[];
  /** UTF-8 bytes for the complete text + structured content + envelope. Default 16 MiB. */
  readonly maxToolResultBytes?: number;
}
/** The host owns cancellation and graph/Reader lifetime. Signals never appear in model JSON arguments. */
export interface ToolCallContext { readonly signal?: AbortSignal }
export interface CapabilityGraphToolkit {
  listTools(): readonly ToolDefinition[];
  callTool(name: string, arguments_: unknown, context?: ToolCallContext): Promise<ToolCallResult>;
}

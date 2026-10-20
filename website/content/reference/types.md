# 公开类型

根入口导出以下类型，与当前新工程保持一致。嵌套字段语义见[方法与结果](/reference/sdk)，默认值见[配置](/reference/configuration)。

<!-- source:src/types.ts -->
```ts
export type ContextScalar = string | number | boolean;
export interface MatchContext { facts?: Record<string, ContextScalar>; notes?: string }
export type Condition =
  | { field: string; op: 'eq'; value: ContextScalar }
  | { field: string; op: 'in'; values: ContextScalar[] }
  | { field: string; op: 'semverRange'; range: string };
export interface ApplicabilityRule { all: Condition[] }
export interface ApplicabilityResult {
  status: 'applicable' | 'inapplicable' | 'unknown';
  missingFacts: string[]; invalidFacts: string[]; failedConditions: string[];
}
export type ForwardRelationKind = 'parents' | 'specializes' | 'related' | 'requires';
export type CapabilityRelations = Partial<Record<ForwardRelationKind, string[]>>;
export type RelationKind = ForwardRelationKind | 'children' | 'specializedBy' | 'relatedBy' | 'requiredBy';
export interface CapabilityUsage {
  instructions?: string; input?: string; output?: string; examples?: string[];
  contract?: { format: 'openapi' | 'mcp-tool' | 'json-schema' | 'other'; uri: string };
}
export interface DocumentRef {
  id: string; title?: string;
  source: { type: 'file'; path: string } | { type: 'url'; url: string };
}
export interface CapabilityDefinition {
  id: string; name: string; description: string; whenToUse?: string;
  usage?: CapabilityUsage; appliesTo?: ApplicabilityRule;
  relations?: CapabilityRelations; documents?: DocumentRef[];
}
export interface ProviderDefinition {
  schemaVersion?: 1; providerId: string; name: string; version: string;
  description?: string; capabilities: CapabilityDefinition[];
}
export type ProviderSource =
  | { file: string; definition?: never; documentRoot?: never }
  | { definition: ProviderDefinition; documentRoot?: string; file?: never };
export interface GraphLimits {
  maxProviderBytes: number; maxCatalogBytes: number; maxResultBytes: number; maxDocumentBytes: number;
  maxInputBytes: number; maxContextBytes: number; maxModelCatalogBytes: number; maxModelOutputBytes: number;
}
export interface OpenOptions {
  providers: ProviderSource[]; allowedProviders?: string[]; model?: ModelExecutor; limits?: Partial<GraphLimits>;
}
export interface ResultMeta {
  revision: string; completeness: 'complete' | 'partial'; warnings: Array<{ code: string; message: string }>;
}
export interface ProviderSummary { providerId: string; name: string; version: string; description?: string; capabilityCount: number }
export interface CatalogEntry {
  id: string; providerId: string; name: string; description: string; whenToUse?: string; appliesTo?: ApplicabilityRule;
}
export interface CapabilityDetail extends CatalogEntry {
  usage?: CapabilityUsage; relations: Record<ForwardRelationKind, string[]>; documents: DocumentRef[];
}
export interface ProviderListResult { items: ProviderSummary[]; meta: ResultMeta }
export interface CatalogResult { items: CatalogEntry[]; meta: ResultMeta }
export interface CapabilityDetailResult {
  items: Array<{ capability: CapabilityDetail; applicability: ApplicabilityResult }>; meta: ResultMeta;
}
export interface RelationEdge { from: string; type: ForwardRelationKind; to: string }
export interface UnresolvedEdge extends RelationEdge { reason: 'target_unavailable' }
export interface ResolvedNode { capability: CapabilityDetail; applicability: ApplicabilityResult; origin: 'selected' | 'dependency' | 'relation' }
export interface ResolveResult { selected: string[]; nodes: ResolvedNode[]; edges: RelationEdge[]; unresolved: UnresolvedEdge[]; meta: ResultMeta }
export type MatchStatus = 'matched' | 'no_match' | 'ambiguous' | 'needs_context';
export interface MatchQuery { input: string; context?: MatchContext; providers?: string[] }
export interface MatchOptions { signal?: AbortSignal; timeoutMs?: number }
export interface MatchResult { status: MatchStatus; selection: { ids: string[]; reason?: string; missingInformation: string[] }; graph: ResolveResult }
export type ModelSelection =
  | { decision: 'selected'; ids: [string, ...string[]]; reason?: string }
  | { decision: 'none'; ids: []; reason?: string }
  | { decision: 'ambiguous'; ids: [string, string, ...string[]]; reason: string }
  | { decision: 'needs_context'; ids: string[]; reason: string; missingInformation: [string, ...string[]] };
export interface ModelSelectionWire { decision: 'selected' | 'none' | 'ambiguous' | 'needs_context'; ids: string[]; reason: string | null; missingInformation: string[] }
export interface ModelSelectRequest { input: string; context: MatchContext; catalog: readonly CatalogEntry[]; revision: string; signal: AbortSignal }
export interface ModelExecutor { readonly id: string; select(request: ModelSelectRequest): Promise<ModelSelection> }
export type ReloadProviderStatus = 'updated' | 'unchanged' | 'failed' | 'not_applied';
export interface ReloadResult {
  ok: boolean; revision: string;
  providers: Array<{ providerId: string; status: ReloadProviderStatus; error?: { code: string; message: string } }>;
  error?: { code: string; message: string };
}
export interface DocumentReadResult {
  capabilityId: string; documentId: string; source: { type: 'file'; path: string };
  text: string; byteLength: number; contentHash: string; meta: ResultMeta;
}
export type ErrorPhase = 'config' | 'load' | 'query' | 'match' | 'document' | 'lifecycle';
export type NextAction = 'fix_input' | 'check_config' | 'refresh' | 'narrow_scope' | 'retry' | 'contact_admin';
export interface GraphErrorShape { code: string; phase: ErrorPhase; message: string; nextAction?: NextAction }
```

/tools 额外导出 GraphToolsOptions、GraphToolDefinition、ToolCallOutcome、GraphTools；/mcp 导出 McpLimits、McpHttpOptions、McpServerOptions、McpServerAddress、McpServer。两个 adapter 各自导出 OpenAIExecutorOptions、CodexExecutorOptions。

GraphError 是 Error 子类，提供 code/phase/可选 nextAction 与 toJSON()；维护命令报告仅是 CLI 输出，不增加根 SDK 导出。

## 子入口导入与完整声明

以下定义摘自包内对应.d.ts。为便于阅读省略了相对import行：CapabilityGraph及GraphErrorShape/MatchOptions/ModelExecutor均来自根入口。下面四个子入口是公开面，内部Provider Schema/helper未因此变成导出模块。

### /tools

把Graph的五/六项查询交给已有Agent工具系统，定义和call借用Graph。

导入路径：`@devcodex/capability-graph/tools`。所有字段和方法如下：

```ts
export interface GraphToolsOptions {
    enableMatch?: boolean;
}
export interface GraphToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
}
export type ToolCallOutcome<T = unknown> = {
    ok: true;
    data: T;
} | {
    ok: false;
    error: GraphErrorShape;
};
export interface GraphTools {
    readonly definitions: readonly GraphToolDefinition[];
    call(name: string, arguments_?: unknown, options?: MatchOptions): Promise<ToolCallOutcome>;
}
export declare function createGraphTools(graph: CapabilityGraph, options?: GraphToolsOptions): GraphTools;
```

### /mcp

创建MCP服务并管理传输，Graph仍由创建者关闭。

导入路径：`@devcodex/capability-graph/mcp`。所有字段和方法如下：

```ts
export interface McpLimits {
    maxBodyBytes?: number;
    maxResponseBytes?: number;
    maxInFlight?: number;
    requestTimeoutMs?: number;
    shutdownTimeoutMs?: number;
}
export interface McpHttpOptions {
    host?: string;
    port?: number;
    path?: string;
    access?: 'local' | 'public-readonly' | 'private';
    auth?: {
        type: 'none';
    } | {
        type: 'bearer';
        token: string;
    };
    publicDocuments?: boolean;
    allowedOrigins?: string[];
    allowedHostnames?: string[];
    limits?: McpLimits;
}
export interface McpServerOptions {
    graph: CapabilityGraph;
    transport: 'stdio' | 'http';
    enableMatch?: boolean;
    http?: McpHttpOptions;
}
export type McpServerAddress = {
    transport: 'stdio';
} | {
    transport: 'http';
    host: string;
    port: number;
    path: string;
    url: string;
};
export interface McpServer {
    start(): Promise<McpServerAddress>;
    waitUntilClosed(): Promise<void>;
    close(): Promise<void>;
}
export declare function createMcpServer(options: McpServerOptions): McpServer;
```

### /adapters/openai

显式选择API模型时使用；不是宿主当前模型的前置依赖。

导入路径：`@devcodex/capability-graph/adapters/openai`。所有字段和方法如下：

```ts
export interface OpenAIExecutorOptions {
    apiKey: string;
    model: string;
    baseURL?: string;
    maxOutputBytes?: number;
    /** Trusted transport override; useful for a managed gateway or controlled tests. */
    fetch?: typeof globalThis.fetch;
}
export declare function createOpenAIExecutor(options: OpenAIExecutorOptions): ModelExecutor;
```

### /adapters/codex

应用独立匹配进程的配置；平台/隔离限制见对应模型页。

导入路径：`@devcodex/capability-graph/adapters/codex`。所有字段和方法如下：

```ts
export interface CodexExecutorOptions {
    /** Official native CLI executable; the verified target is 0.163.0. */
    command?: string;
    authHome?: string;
    scratchRoot?: string;
    /** Read-only installation resources, excluding business files and credentials. */
    runtimeRoot?: string;
    model?: string;
    maxOutputBytes?: number;
}
export declare function createCodexExecutor(options?: CodexExecutorOptions): ModelExecutor;
```

### GraphError

根入口的Error子类；普通异步查询reject该错误，reload候选失败另以ok:false返回。

```ts
export declare class GraphError extends Error implements GraphErrorShape {
    readonly code: string;
    readonly phase: ErrorPhase;
    readonly nextAction?: NextAction;
    constructor(code: string, phase: ErrorPhase, message: string, nextAction?: NextAction);
    toJSON(): GraphErrorShape;
}
```

CLI维护报告不是根入口类型，Graph不导出内部Schema；不要从包内dist私有路径导入未声明模块。

import { freeze } from "../validate/values.js";
import type { ToolDefinition } from "./types.js";

type Schema = Record<string, unknown>;
const string = { type: "string", minLength: 1 };
const integer = (minimum = 1): Schema => ({ type: "integer", minimum, maximum: Number.MAX_SAFE_INTEGER });
const array = (items: Schema, extra: Schema = {}): Schema => ({ type: "array", items, ...extra });
const object = (properties: Schema, required: readonly string[] = []): Schema => ({ type: "object", properties, required, additionalProperties: false });
const identity = object({ providerId: string, capabilityId: string }, ["providerId", "capabilityId"]);
const scope = { requestProviderScope: array(string, { uniqueItems: true }) };
const revision = { requiredStaticRevision: string };
const pagination = { cursor: string, limit: integer(), ...revision };
const body = { knowledgeId: string, startOffset: integer(0), maxBytes: integer(), cursor: string, ...revision, ...scope };
const filters = { knowledgeIds: array(string), locales: array(string) };
const kinds = ["parents", "children", "specializes", "specializedBy", "related", "relatedBy", "requires", "requiredBy"];
const dictionary = { type: "object", additionalProperties: string };
const definitions: readonly [string, string, Schema, readonly string[], boolean?][] = [
  ["list_providers", "列出获准Provider及其静态修订。", { ...scope, ...revision }, []],
  ["get_provider", "读取指定Provider的元数据，不读取规范正文。", { providerId: string, ...revision, ...scope }, ["providerId"]],
  ["list_specification_documents", "分页列出指定Provider声明的规范文档。", { providerId: string, ...pagination, ...scope }, ["providerId"]],
  ["list_catalog", "分页发现能力目录，不读取文档正文。", { ...scope, ...pagination, capabilityIdPrefix: string, parent: identity }, []],
  ["get_capabilities", "按输入顺序读取能力详情并保留失败槽位。", { ids: array(identity), ...scope, ...revision,
    neighborLimitPerKind: integer(), knowledgeLimit: integer(), knowledgeCursors: dictionary }, ["ids"]],
  ["list_knowledge_members", "分页列出显式Collection的文档成员。", { capability: identity, collectionId: string, ...pagination, ...scope }, ["capability", "collectionId"]],
  ["get_neighbors", "分页查询八类本Provider关系。", { capability: identity, kinds: array({ enum: kinds }), limitPerKind: integer(),
    cursors: { type: "object", properties: Object.fromEntries(kinds.map(kind => [kind, string])), additionalProperties: false },
    ...revision, ...scope }, ["capability"]],
  ["resolve_selection", "沿requires解析用户显式选择的必要上下文，不读取正文。", { selected: array(identity, { minItems: 1 }),
    ...scope, requiredStaticRevisionByProvider: dictionary }, ["selected"]],
  ["read_documents", "读取显式选择的Document或Collection成员原文。", { selected: array(identity, { minItems: 1 }),
    ...filters, roles: array(string), ...scope, ...revision }, ["selected"], true],
  ["read_document_page", "分页读取一篇显式Document，保留原字节与内容身份。", { capability: identity, ...body }, ["capability", "knowledgeId"], true],
  ["read_specification", "读取指定Provider显式筛选的规范原文。", { providerId: string, ...filters, ...revision, ...scope }, ["providerId"], true],
  ["read_specification_page", "分页读取一篇显式规范文档。", { providerId: string, ...body }, ["providerId", "knowledgeId"], true],
];

/** One shared definition set for embedded hosts and transports; imports do not open sources or start services. */
export function toolDefinitions(prefix: string): readonly ToolDefinition[] {
  return freeze(definitions.map(([suffix, description, properties, required, openWorldHint = false]) => ({
    name: prefix + suffix, description, annotations: { readOnlyHint: true as const, destructiveHint: false as const,
      idempotentHint: true as const, openWorldHint },
    inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", ...object(properties, required) },
  })));
}

# 可选模型匹配

静态目录与 resolve 不需要模型。默认 MCP 由宿主自己选择能力，避免额外调用。SDK 主动匹配才配置 executor：

```js
import { CapabilityGraph } from '@devcodex/capability-graph';
import { createOpenAIExecutor } from '@devcodex/capability-graph/adapters/openai';

const apiKey = process.env.CG_MODEL_API_KEY;
const model = process.env.CG_MODEL_NAME;
if (!apiKey || !model) throw new Error('Configure CG_MODEL_API_KEY and CG_MODEL_NAME');
const graph = await CapabilityGraph.open({
  providers: [{ file: './provider.json' }],
  model: createOpenAIExecutor({ apiKey, model })
});
try {
  const result = await graph.match({ input: 'Create an HTTP endpoint', context: { facts: { framework: 'acme' } } }, { timeoutMs: 60000 });
  console.log(result.status, result.selection, result.graph);
} finally { await graph.close(); }
```

OpenAI 路径另装 `openai@^7.39.0`。显式 apiKey/model，可选 HTTPS baseURL、maxOutputBytes（默认 65536）、可信 fetch 传输覆盖。实际使用 Responses API strict Structured Outputs，store:false，关闭自动重试；只发送本次 input、Context、授权精简 Catalog 和 Revision，不扫描项目/读取文档。默认遵循 HTTPS_PROXY/HTTP_PROXY 和系统 CA；定制网关用受信任 fetch。不要把测试用合成 key 当成可用凭据。

本地 Codex 路径由用户选择直接调用 CLI，不需要 Codex SDK：

```js
import { createCodexExecutor } from '@devcodex/capability-graph/adapters/codex';
const model = createCodexExecutor({
  command: '/opt/pinned-codex/bin/codex',
  runtimeRoot: '/opt/pinned-codex',
  authHome: '/private/dedicated-codex-home',
  scratchRoot: '/var/tmp/capability-graph-matcher'
});
```

当前适配器只支持实际验证的 **Linux + bubblewrap + native CLI 0.163.0**。用独立 CODEX_HOME 运行该 CLI 的 `login --device-auth` 并完成浏览器授权，先检查 `login status`；不要把凭据发到聊天或复制进项目。command 默认从 PATH 解析 codex；runtimeRoot 默认原生文件所在目录，部署时应显式指定仅含可信 CLI 资源的最小安装目录。不要把整个业务目录或凭据目录作为 runtimeRoot。authHome 默认既有 CODEX_HOME 或 ~/.codex，但推荐独立登录目录。可选 model/maxOutputBytes；不支持的版本/平台/隔离条件返回 CG_MODEL_EXECUTOR_UNSAFE，不降级为无沙盒执行。

每次匹配新建独立工作目录与 HOME，只读绑定指定 auth.json，不复制凭据；业务仓库和其他用户目录不挂载。CLI 使用 ephemeral/read-only/固定输出 Schema，禁用 shell、apps、plugins、browser 和执行工具，不接管桌面会话。模型 API 需要网络，因此进程保留 API 网络通道；这里不宣称操作系统对全部 CLI 网络完全断网。系统库/证书、CLI 安装及父目录必须可信。auth 只读绑定不能更新过期登录缓存，届时应在独立目录重新登录。父进程管理进程组、限流输出、取消/终止/回收并清理 scratch。普通嵌套沙盒不能运行 bubblewrap 时，需要部署提供相应隔离运行条件。

可注入任意符合接口的借用 executor：

```ts
interface ModelExecutor {
  readonly id: string;
  select(request: {
    input: string; context: MatchContext; catalog: readonly CatalogEntry[];
    revision: string; signal: AbortSignal;
  }): Promise<ModelSelection>;
}
```

请求 JSON 部分不可变；executor 不得依赖修改它或执行能力。返回 union：selected 需至少 1 个唯一候选 ID；none 的 ids 为 []；ambiguous 至少 2 个候选且必填 reason；needs_context 必填 reason 和非空 missingInformation，可带候选 IDs。不得返回目录外、重复或未授权 ID。内置适配器的线格式固定四个必填字段 decision/ids/reason（string|null）/missingInformation，再规范化为该公开 union。

match 返回 status 为 matched/no_match/ambiguous/needs_context，selection 含 ids/可选 reason/missingInformation；graph 按同一固定 Snapshot 执行默认 requires 解析，selection.ids 与 graph.selected 一致。多项都需要时是 matched，多项互斥选择才是 ambiguous。模型判断与节点 applicability 分别呈现，unknown 不被自动转成 needs_context。

默认 60000ms，允许 1–600000 的 timeoutMs，涵盖整次匹配。外部 signal、deadline、close 由首先观察到的终止决定；迟到成功被丢弃。不合作的外部 executor 也不会让 Graph 永久等待，但资源清理仍是该 executor 的责任。借用的 executor 不被 Graph.close 关闭。空候选在配置 executor 后直接 no_match，不调用模型；没有配置时仍报 CG_MODEL_NOT_CONFIGURED。

错误包括 CG_MODEL_NOT_CONFIGURED/UNAVAILABLE/EXECUTOR_UNSAFE/CONTEXT_EXCEEDED/OUTPUT_INVALID/OUTPUT_TOO_LARGE/REFUSED/TIMEOUT/CANCELLED。OpenAI API 凭据与 Codex CLI 网页授权分别配置，运行条件见[版本与兼容](/resources/compatibility)。


## 三个判断维度

- status 是模型选择：matched/no_match/ambiguous/needs_context。
- graph.nodes[].applicability.status 是静态条件判断：applicable/inapplicable/unknown。
- graph.meta.completeness 是依赖/关系完整性：complete/partial。

多项都需要可以 matched；互斥方案缺少选择依据才 ambiguous。unknown 不自动转成 needs_context。无候选时在有配置 executor 的前提下直接 no_match，不调用模型；没配 executor 仍报配置错误。

超时默认 60000ms，timeoutMs 范围 1–600000，不能为 null。signal/deadline/close 的最先观察到的终止生效，迟到成功丢弃。自定义 executor 自己负责关闭不合作的底层资源。

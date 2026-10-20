# 独立 Codex CLI 匹配

本页用于 Node.js 应用主动调用 match。普通 Codex 用户复用当前模型请走[宿主接入](/integrations/codex)，无需为该路线建立独立匹配进程。

当前适配器要求Linux + bubblewrap + 原生Codex CLI0.163.0。不使用Codex SDK，不接管桌面当前会话。不支持的平台/版本/隔离条件报CG_MODEL_EXECUTOR_UNSAFE，不降级到无隔离运行。

这里描述当前适配器的限制；你的部署仍需按下列前提真实运行后才能算接入通过。仅在Windows阅读或编译示例不证明Linux隔离或CLI登录有效。

1. 安装固定版本原生 CLI 与 bubblewrap，准备只含可信 CLI 资源的 runtimeRoot。
2. 用独立 CODEX_HOME 运行该 CLI 的 login --device-auth，浏览器授权后 login status 检查。authHome 由你管理，不复制登录文件进项目。
3. 创建独立 scratchRoot，传入 createCodexExecutor，并配置 Graph.open 的 model。完整调用与运行命令见本页下方“Linux运行步骤”。

| 字段 | 默认与说明 |
| --- | --- |
| command | 省略查 PATH 的 codex；建议显式原生文件绝对路径 |
| runtimeRoot | 默认原生文件所在目录；最小可信安装资源根，不包括业务目录或凭据目录 |
| authHome | 默认 CODEX_HOME 或 ~/.codex；推荐专用登录目录，只读绑定 auth.json |
| scratchRoot | 默认系统临时目录下的专用工作空间；部署可显式指定 |
| model | 可选，明确需要时指定 |
| maxOutputBytes | 默认 65536，正安全整数 |

每次匹配新建独立工作目录和 HOME，只读最小挂载，不挂载业务仓库和私有目录。CLI 禁用执行工具/apps/plugins/browser，使用固定候选结构；进程组受取消/超时/输出预算控制，结束清理。API 调用需要网络，不宣称整个 CLI 全部断网。

系统库、证书、可信安装及父目录由部署控制。认证只读绑定不能刷新过期缓存，过期时在专用目录重新登录。云端嵌套沙盒若不能提供 bubblewrap 所需权限，要部署提供隔离运行条件。

## Linux运行步骤

先在已安装原生CLI 0.163.0和bubblewrap的Linux环境检查版本、完成独立登录。以下路径均须替换为你实际准备的可信目录，不要原样复制到不相符的机器：

```bash
/opt/pinned-codex/bin/codex --version
bwrap --version
CODEX_HOME=/private/dedicated-codex-home /opt/pinned-codex/bin/codex login --device-auth
CODEX_HOME=/private/dedicated-codex-home /opt/pinned-codex/bin/codex login status
```

在你的ESM应用安装 `npm install @devcodex/capability-graph`，按[快速开始](/getting-started/quick-start)保存provider.json，再在旁边保存codex.mjs：

```js title="codex.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { createCodexExecutor } from '@devcodex/capability-graph/adapters/codex';
import { fileURLToPath } from 'node:url';

let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }],
    model: createCodexExecutor({
      command: '/opt/pinned-codex/bin/codex',
      runtimeRoot: '/opt/pinned-codex',
      authHome: '/private/dedicated-codex-home',
      scratchRoot: '/var/tmp/capability-graph-matcher'
    })
  });
  console.log(JSON.stringify(await graph.match({ input: '创建带请求校验的 Acme HTTP 接口' }), null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

执行 `node codex.mjs` 会创建一次独立匹配进程并使用其登录授权，不复用当前桌面聊天。成功输出完整MatchResult，按[四状态](/models/match)处理；隔离、登录、模型可用性或协议问题按错误恢复，不能把失败记为no_match。支持平台之外使用[当前宿主MCP路线](/integrations/codex)。

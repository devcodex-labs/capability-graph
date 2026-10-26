# 安装

本手册对应 Capability Graph **v2.1.1**。使用 Node.js 20.19+（20.x）或 >=22.12.0，支持 JavaScript/TypeScript 和 ESM。运行条件见[版本与兼容](/resources/compatibility)。

:::tip 版本条件
Node 20 与 SDK 6 支持从 v2.1.0 开始。若仍使用 v2.0.1，请使用 Node >=22.12.0 和 SDK 7。在应用中执行 npm ls @devcodex/capability-graph 核对实际安装版本；站点随 main 更新。
:::

## 安装到你的应用

在已有应用目录执行安装命令，或新建一个示例项目：

```sh
mkdir graph-demo
cd graph-demo
npm init -y
npm install @devcodex/capability-graph
```

使用 .mjs 可以直接执行；.js 所在 package.json 需设置 type:module。TypeScript 使用同一 API 和包内类型，编译到 NodeNext/ESM 后运行，不需要项目源码或链接源码 node_modules。

## 命令使用方式

项目本地安装后，先按[快速开始](/getting-started/quick-start)创建 graph.config.json，再在该项目执行：

```sh
npx --no-install capability-graph doctor --config graph.config.json
```

`--no-install` 使用项目里已安装的 CLI。

需要跨项目使用 CLI 或为 Codex 登记服务时，可以全局安装：

```sh
npm install --global @devcodex/capability-graph
capability-graph doctor --config /absolute/path/graph.config.json
```

GUI 宿主使用已安装 bin 的绝对路径；[Codex setup](/integrations/codex) 会保存当前 Node、CLI 和配置的绝对路径。

安装不启动服务、不调用模型、不登记宿主。静态 SDK、CLI、Tool 和 MCP 不要求模型 SDK 或凭据。独立 Codex adapter 使用原生 CLI，不使用 Codex SDK。

应用主动使用 OpenAI 匹配时，再按运行环境选择一个可选 SDK，命令在应用项目中执行：

| 运行环境 | 可选 SDK | 安装命令 |
| --- | --- | --- |
| Node 20.19+（20.x） | 6.49.0 | `npm install @devcodex/capability-graph openai@6.49.0` |
| Node 22.12+ / 24 | 7.39.0；也兼容 6.49.0 | `npm install @devcodex/capability-graph openai@7.39.0` |

不要在 Node 20 安装 SDK 7。安装完成后按 [OpenAI 调用说明](/models/openai)显式配置 API Key 和有权限的模型；安装成功不代表模型账号已验证。

安装后可运行[第一个图谱](/getting-started/quick-start)，或选择[宿主接入方式](/integrations/overview)。源码贡献者的构建和测试见[开发说明](/resources/development)。

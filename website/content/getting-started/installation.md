# 安装

本手册对应 Capability Graph **v2.0.0**。使用 Node.js >=22.12.0，支持 JavaScript/TypeScript 和 ESM。运行条件见[版本与兼容](/resources/compatibility)。

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

安装不启动服务、不调用模型、不登记宿主。静态 SDK 不要求 OpenAI SDK、Codex SDK 或模型凭据。主动 OpenAI 匹配另装 openai@7.39.0；独立 Codex adapter 使用原生 CLI，不使用 Codex SDK。

安装后可运行[第一个图谱](/getting-started/quick-start)，或选择[宿主接入方式](/integrations/overview)。源码贡献者的构建和测试见[开发说明](/resources/development)。

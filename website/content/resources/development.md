# 源码开发与检查

本页面面向源码贡献者。应用集成请按[安装说明](/getting-started/installation)使用 npm 包，无需克隆本仓库。

当前源码开发基线为 Node 20.19.0、openai@6.49.0、@types/node@20.19.0；Node 22.12+/24 保留回归。站点使用同一Node范围，保留自身types24及现有Rspress版本。

```sh
npm ci --engine-strict
npm test
npm run build
npm run smoke:package
npm run test:release
npm --prefix website ci
npm run docs:check
npm run docs:examples
npm run docs:build
```

CG_BUILD_DIR、CG_TEST_DIR、CG_ARTIFACTS_DIR 可指定仓库外编译、夹具与消费者目录。站点使用 CG_SITE_BUILD_DIR，默认仓库同级 capability-graph-site-artifacts/site；测试截图/报告使用独立站点产物目录。配置不允许站点输出覆盖源码。

npm run docs:dev 启动本地开发，docs:build 生成静态站，docs:check 校对链接/公开 API 覆盖/示例，docs:browser 使用真实浏览器验证页面和导航。站点构建输出与浏览器截图保存在仓库外。

smoke:package 在独立目录构建并安装 npm 包，检查所有公开入口、TypeScript（skipLibCheck=false）、ESM、CLI、MCP 与示例；不链接源码 node_modules。普通测试使用受控模型执行器，不要求凭据或自动产生模型调用费用。真实模型与远程宿主的集成验证需单独准备账号和部署环境。

冷包保留无SDK消费者，并为SDK6建立独立消费者；在Node22.12+/24还单独安装SDK7，检查有效依赖树、types20和受控Responses。要验证SDK7的完整测试，另在Node22.12+/24运行：

```sh
npm run test:openai:compat
```

该入口复制当前工作文件到仓外，只在副本固定openai@7.39.0，严格安装并运行全部测试；不会修改原manifest、lock或node_modules。Node20执行时明确拒绝，基础npm test使用SDK6。

Windows的Node22.12验收工具若在过深中文产物路径以0xC0000005退出，可先将CG_ARTIFACTS_DIR设为较短的仓外目录；该目录仍可含空格和中文。保留失败日志再复证，不用忽略退出码或开启skipLibCheck处理。

MCP取消回归使用测试进程信号确认进入与取消，并覆盖5秒迟到确认；缺信号仍按10秒有界等待失败。CLI命令、维护回归及冷包bin的90秒测试外限包含冷启动、实际MCP发现和回收，失败输出命令、耗时、退出状态与子进程信息。服务就绪测试使用45秒外限，同时观察早退与超时，失败后回收子进程。维护诊断的总预算与首次工具列表发现统一采用MCP SDK标准60秒，因为现代stdio connect后仍可能需要加载服务模块；另有真实服务延迟11秒及PID回收回归。这些内部上限不增加用户配置项，不改变业务请求、HTTP或模型超时。

docs:examples 复用同一次冷包/独立消费者检查，再按 website/scripts/example-cases.json 提取页面中的完整脚本并执行，逐字核对分发示例、完整 ResolveResult、预期错误、MCP 两种传输和旧版 stdio 协议。它还编译五入口的全部公开类型，验证 Plugin 路径及远程配置；自定义模型只使用受控传输。条件用例明确记录 NOT_RUN 和所需账号、平台或宿主，不会自动请求付费模型、安装 Plugin 或部署公网服务。公开 Registry 的全新安装需在对应版本发布后另行补验；内部打包通过不能替代该记录。

docs:check 使用 TypeScript 解析器对照公开声明和九个 SDK 方法签名，并检查全部站点路由、链接和引用片段。docs:browser 在浅/深主题及 1440/390 两个视口检查全部路由，保存十个关键页面的 40 组截图，核对复制内容、语法高亮、正文对比度、搜索焦点与键盘菜单。可用 CG_BROWSER_EXECUTABLE 指定已安装浏览器，CG_SITE_ARTIFACTS_DIR 指定仓库外截图目录；验证退出时关闭本次本地服务。

后续开发直接使用 main。GitHub Actions 检查 Linux/Windows × Node 20.19.0/22.12.0/24 的SDK6基础测试与冷包；仅22.12/24额外运行SDK7完整测试。文档有独立构建与浏览器检查。推送 main 后自动部署 Pages；推送稳定版本 tag 后，release.yml 完成 npm 和 GitHub Release 发版。也可以手动部署文档。步骤与认证配置见[维护者发版](/resources/releasing)。

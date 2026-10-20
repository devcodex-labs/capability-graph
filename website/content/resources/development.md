# 源码开发与检查

本页面面向源码贡献者。应用集成请按[安装说明](/getting-started/installation)使用 npm 包，无需克隆本仓库。

```sh
npm ci
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

docs:examples 复用同一次冷包/独立消费者检查，再按 website/scripts/example-cases.json 提取页面中的完整脚本并执行，逐字核对分发示例、完整 ResolveResult、预期错误、MCP 两种传输和旧版 stdio 协议。它还编译五入口的全部公开类型，验证 Plugin 路径及远程配置；自定义模型只使用受控传输。条件用例明确记录 NOT_RUN 和所需账号、平台或宿主，不会自动请求付费模型、安装 Plugin 或部署公网服务。公开 Registry 的全新安装需在对应版本发布后另行补验；内部打包通过不能替代该记录。

docs:check 使用 TypeScript 解析器对照公开声明和九个 SDK 方法签名，并检查全部站点路由、链接和引用片段。docs:browser 在浅/深主题及 1440/390 两个视口检查全部路由，保存五个关键页面的 20 组截图，核对复制内容、语法高亮、正文对比度、搜索焦点与键盘菜单。可用 CG_BROWSER_EXECUTABLE 指定已安装浏览器，CG_SITE_ARTIFACTS_DIR 指定仓库外截图目录；验证退出时关闭本次本地服务。

后续开发直接使用 main。GitHub Actions 检查 Linux/Windows 与 Node 22/24 的 SDK/消费者，文档有独立构建与浏览器检查。推送 main 后自动部署 Pages；推送稳定版本 tag 后，release.yml 完成 npm 和 GitHub Release 发版。也可以手动部署文档。步骤与认证配置见[维护者发版](/resources/releasing)。

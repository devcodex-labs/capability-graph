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
npm run docs:build
```

CG_BUILD_DIR、CG_TEST_DIR、CG_ARTIFACTS_DIR 可指定仓库外编译、夹具与消费者目录。站点使用 CG_SITE_BUILD_DIR，默认仓库同级 capability-graph-site-artifacts/site；测试截图/报告使用独立站点产物目录。配置不允许站点输出覆盖源码。

npm run docs:dev 启动本地开发，docs:build 生成静态站，docs:check 校对链接/公开 API 覆盖/示例，docs:browser 使用真实浏览器验证页面和导航。站点构建输出与浏览器截图保存在仓库外。

smoke:package 在独立目录构建并安装 npm 包，检查所有公开入口、TypeScript（skipLibCheck=false）、ESM、CLI、MCP 与示例；不链接源码 node_modules。普通测试使用受控模型执行器，不要求凭据或自动产生模型调用费用。真实模型与远程宿主的集成验证需单独准备账号和部署环境。

后续开发直接使用 main。GitHub Actions 检查 Linux/Windows 与 Node 22/24 的 SDK/消费者，文档有独立构建与浏览器检查。推送 main 后自动部署 Pages；推送稳定版本 tag 后，release.yml 完成 npm 和 GitHub Release 发版。也可以手动部署文档。步骤与认证配置见[维护者发版](/resources/releasing)。

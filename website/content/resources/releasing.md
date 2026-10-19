# 维护者发版

本页面向仓库维护者。普通应用按[安装说明](/getting-started/installation)使用 npm 包。

开发直接使用 main。推送 `vMAJOR.MINOR.PATCH` 稳定版本 tag 后，`publish.yml` 自动完成以下步骤：

1. 检查 tag、包版本、锁文件、Plugin、站点与 MCP 身份版本，并确认该提交属于 main。
2. 运行 Linux/Windows × Node 22/24 的测试与独立消费者，以及文档构建、浏览器检查和发版保护测试。
3. 构建一个经过独立消费者验证的 npm 包，生成 SHA256SUMS，查询 Registry 是否已有相同版本。
4. 发布该包并附 npm provenance，再下载 Registry 包核对字节，检查精确版本和默认安装、公开入口与 CLI。
5. 创建或恢复同名 GitHub Release，上传同一个包与 SHA256SUMS。
6. 部署该 tag 对应提交的 Pages 文档。

main 的普通 push 运行检查，不自动发布包或部署文档。Pages 仍保留独立的手动部署入口。

## 一次性认证配置

npm 发布 job 使用仓库现有的 **npm-production** 环境。该环境的部署规则需允许稳定版本 tag。

推荐在 npm 包的 Trusted Publisher 设置中指定：

| 字段 | 值 |
| --- | --- |
| CI 提供方 | GitHub Actions |
| 组织/用户 | devcodex-labs |
| 仓库 | capability-graph |
| Workflow 文件 | publish.yml |
| Environment | npm-production |

工作流使用 Node 24、随附 npm 和 `id-token: write`。如果使用 token 认证，在 npm-production 环境或仓库 Secret 中配置具有此包发布权限的 **NPM_TOKEN**。Secret 的值通过 GitHub 设置录入。

GitHub Release 使用 job 的 GitHub token，无需个人 PAT。Pages 的发布源使用 GitHub Actions，github-pages 环境需允许 main 和版本 tag。组织审批规则或环境保护仍由 GitHub 执行。

## 准备版本

在 main 同步以下内容并提交：

- 根 package.json、package-lock.json 及锁文件根包的版本。
- plugin/plugin.json、plugin/.codex-plugin/plugin.json 的版本。
- website/package.json、website/package-lock.json 及其根包版本。
- src/mcp/index.ts 与 src/cli/diagnose.ts 中的协议身份版本。
- 站点页脚、首页、llms.txt 生成器、README 和安装示例里的本包版本。
- 根 CHANGELOG.md 中本版本的 `## MAJOR.MINOR.PATCH` 段落。

历史 changelogs/ 保持原样；发版说明取自新的根 CHANGELOG.md。

```sh
git switch main
git pull --ff-only
npm ci
npm run release:check
npm run test:release
npm test
npm run smoke:package
```

版本、文档和测试提交推送至 main 后，以 2.0.0 为例：

```sh
git tag -a v2.0.0 -m "Release v2.0.0"
git push origin v2.0.0
```

仅推送 tag 会触发正式发布；工作流不自行创建 tag。预发布版本 tag 暂不支持，格式错误或版本不一致会在发布前失败。

## 只读演练

在 Actions 选择 **publish tagged version → Run workflow → main**，或执行：

```sh
gh workflow run publish.yml --ref main
```

手动运行只执行预检、CI、独立打包、Registry 查询与产物上传，npm 发布、GitHub Release 和 Pages job 全部跳过。演练通过证明这些检查可运行；发布凭据和实际线上结果需要正式 tag 流程确认。

## 中断后的恢复

使用原 tag 的 **Re-run failed jobs** 或 **Re-run all jobs**。同版本、同内容会跳过重复 npm 发布，继续核验和后续步骤；同版本内容不一致会失败，不能覆盖 Registry。若 `latest` 已高于当前版本，也会拒绝回退。

发版工作流按仓库串行运行；等待一个版本完成后再推送下一个版本 tag。

GitHub Release 可恢复说明和附件；Pages 仅在 Registry 验证与 GitHub Release 成功后执行。失败时查看对应 job 的日志、npm-package 与 npm-registry-verification 产物。不要删除或移动已发布 tag 来规避版本冲突。

# VextJS 官方文档 Provider

此源码示例从固定 VextJS 提交导出官方原始 Markdown/MDX，以官方主题组织能力定义和文档关联；主包保持框架无关。固定快照 `ef926649926e17543562b8169982fa1786285ecf` 含 91 篇文档、46 个主题，86 篇关联主题，5 篇参考资料单列。新增未分类或缺失章节会拒绝导出。

能力及关联由集成作者维护，knowledge 逐篇保留官方原字节，metadata 保存 Git blob、SHA-256、来源与原生编号映射；不是临时编写的知识正文。directory 模式使用 capabilities/**/*.json，不需要 .capability 后缀。同来源导出稳定，更新时重新导出到新目录并显式 reload。

## 验证

先准备上述固定源码、安装其 lockfile 并完成真实 CLI 构建，再在 Core 仓库运行：

```sh
npm run build
npm run build:tests
node scripts/validation/vextjs-documentation.mjs /absolute/vextjs-fixed ef926649926e17543562b8169982fa1786285ecf
node scripts/validation/vextjs-compatibility.mjs /absolute/vextjs-fixed ef926649926e17543562b8169982fa1786285ecf
node scripts/validation/vextjs-consumer.mjs /absolute/vextjs-fixed ef926649926e17543562b8169982fa1786285ecf --https
```

文档入口核验全部原文、图谱目录/详情/邻居/Selection 和正文分页。兼容入口增加真实原生 MCP 声明回读及本地来源矩阵。消费者入口在仓库外新建项目，实际安装当前 Core 和固定 VextJS tarball、锁定的 MonSQLize 包，所有图谱查询使用其实际安装的 Core 公共入口，不使用 node_modules 符号链接。

来源矩阵保留 Provider 原文、显式外部目录、两个 node_modules 包的 README/CHANGELOG/MIGRATION、显式安装目录和两篇真实 HTTPS 长/短文。每页核对连续 UTF-8 偏移、全文/页哈希与续读标记，拼接等于原文；独立期望文本直接与读回正文核对。`--https` 同时核验 MonSQLize Registry integrity；省略时不证明公网访问。

原生 MCP 仅审计固定来源的声明，不证明业务执行。2.0 移除了检索任务、Runtime Adapter、数据库应用、Session/CSRF 和完整框架业务验收；它们保留在 v1.1.0 历史。当前验证不宣称覆盖 VextJS 的全部业务功能或 Agent 成功率。

固定源码的版本文本虽然为 2.0.0，但 npm vextjs@2.0.0 不包含同样 MCP 和官网内容，不能仅凭版本号视为等价来源。框架 Windows Node 22 的文件身份问题使用 22.23.3 验证；Core 自己仍验证 22.12.0。CI 声明 Linux/Windows、Node 20/22/24，实际通过以运行记录为准。

## HTTP 分页成本

`node --expose-gc scripts/validation/knowledge-page-profile.mjs` 在独立子进程测量受控 5 MiB HTTP 正文：强 ETag 与范围证明读取完整 160 页、无证明的前三页回退、并发读取、真实传输和扫描字节、采样内存。来源没有大小准入上限；结果是本机合成场景，不是生产吞吐承诺。

## 目录与产物

生成的 Provider 按 providers/vextjs、providers/monsqlize 分开，knowledge 为 Markdown/MDX；正文出处、未关联参考资料及检查证据明确记录。导出目录、验证消费者、下载、日志、快照和报告都位于仓库同级专用目录，通过 CG_ARTIFACTS_DIR 控制。正式材料只保留在 examples、test 和 scripts；website 仅放文档、主题与站点配置。

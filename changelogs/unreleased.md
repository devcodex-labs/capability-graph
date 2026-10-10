# 未发布变更

- `readDocuments()` / `readSpecification()` 新增独立的原始输入与完整 JSON 响应预算：`read.maxSelected=32`、`read.maxFilterValuesPerDimension=128`、`read.maxResponseBytes=4194304`。原始数量在去重、查询 pin 和 Authority 点读前检查；计划文档数超限在 Reader 调用前检查；完整响应包含正文转义、错误、meta 与 view。
- 超出这些默认值的旧请求现在报查询级 `CG_BUDGET_EXCEEDED`，`nextAction=page_or_filter`。请拆分选择和过滤值，或在 `CapabilityGraph.open({ budgets: { read: { ... } } })` 中显式覆盖上限。总响应检查可能发生在有界 I/O 之后；单篇超限仍为逐项失败。原有每篇 32768 字节、每次 8 篇的默认值不变，`queryKnowledge()` 使用自己的预算。新增字段在公开完整 `BudgetConfig` 中可省略，旧类型配置继续可编译。
- 文件视图的反向关系索引改为追加自有数组，消除高扇入节点构建时反复复制邻接表的成本；关系去重、排序及作者数组保持原有语义。
- 私有 Node.js HTTP 示例增加真实文档 Reader 与有限文本索引，覆盖原始字节、BOM/中文/补充字符偏移、来源限制、截止与连接终止，以及正文/映射/配置失效与显式恢复；不作为主包后端导出，也不声明模型任务效果。
- MCP 增加 Collection 与检索协议回归；新增 `npm run evaluate:capacity`，从仓库外的真实文件来源执行多 Provider 混合查询、reload、close 验证，报告同样保存在仓库同级目录。
- 文档测试移到根 `test/website`，固定材料移到 `test/fixtures/website`，验证工具移到 `scripts/validation/website`。站点生成片段、制品、临时消费者、截图与报告位于仓库同级 `capability-graph-artifacts`；Docs CI 同步输入路径并增加 Firefox/WebKit 代表性冒烟。

上述 1.1.0 内容汇总于 [版本记录](1.1.0.md)。实际发布与站点版本以 Registry 和站点 release.json 为准。


## 1.1.0 汇总

- 新增显式 directory 文件布局：capabilities/**/*.json；旧配置缺省 legacy。能力身份取 capabilityId，布局迁移不改变同记录修订。错误目录、混用、嵌套 manifest 和文件冲突明确失败；Seed、MCP 与站点消费者教程一起迁移。
- 新增每 Provider knowledgeRoots 与 relative-file locator.root。显式获准目录、scoped/普通安装包、pnpm 真实根和 Unicode/空格路径可直接读取；私有路径不进入 Retriever 或结果。
- 检索对未使用 access 的外部后端也实际核验全部来源与片段，包括零命中；数据库目录和全部八类关系完整性受核验。
- 全文/Specification 保留 BOM/CRLF，MDX MIME 与分页一致；Runtime 白名单保留修订/上下文错误，去除 Adapter 私有诊断。
- HTTP 源码参考支持宿主代理 Agent、强 ETag 完整快照复用和无验证器/超缓存预算流式回退；参考索引按计账字节/条目预算保留，超额流式 Top-K，文档总大小不设准入上限。
- VextJS 固定源码/安装构建指纹、原生回读、独立任务召回门槛、官方章节关联与 VextJS/MonSQLize 双 Provider 来源矩阵可复现。无官方章节关联的原生条目明确单列，文档验证不等同于执行或 Agent 成功。

外部索引须配置真实来源 Reader；无需调用 access 才能接入，但未经核验的自报哈希不能继续充当 current 证据。数据库 Adapter 须完整返回八类关系，漏项会明确拒绝。新 API 需对应版本的安装包；源码提交不会自动发布 Registry/tag 或部署站点。

- `read.maxPageBytes=32768` 与旧全文单篇 `read.maxBytes` 分离；大文档继续完整分页，短段落边界扫描不再反复计算所有 UTF-8 前缀。

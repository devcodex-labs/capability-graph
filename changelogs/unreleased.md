# 未发布变更

- `readDocuments()` / `readSpecification()` 新增独立的原始输入与完整 JSON 响应预算：`read.maxSelected=32`、`read.maxFilterValuesPerDimension=128`、`read.maxResponseBytes=4194304`。原始数量在去重、查询 pin 和 Authority 点读前检查；计划文档数超限在 Reader 调用前检查；完整响应包含正文转义、错误、meta 与 view。
- 超出这些默认值的旧请求现在报查询级 `CG_BUDGET_EXCEEDED`，`nextAction=page_or_filter`。请拆分选择和过滤值，或在 `CapabilityGraph.open({ budgets: { read: { ... } } })` 中显式覆盖上限。总响应检查可能发生在有界 I/O 之后；单篇超限仍为逐项失败。原有每篇 32768 字节、每次 8 篇的默认值不变，`queryKnowledge()` 使用自己的预算。新增字段在公开完整 `BudgetConfig` 中可省略，旧类型配置继续可编译。
- 文件视图的反向关系索引改为追加自有数组，消除高扇入节点构建时反复复制邻接表的成本；关系去重、排序及作者数组保持原有语义。
- 私有 Node.js HTTP 示例增加真实文档 Reader 与有限文本索引，覆盖原始字节、BOM/中文/补充字符偏移、来源限制、截止与连接终止，以及正文/映射/配置失效与显式恢复；不作为主包后端导出，也不声明模型任务效果。
- MCP 增加 Collection 与检索协议回归；新增 `npm run evaluate:capacity`，从仓库外的真实文件来源执行多 Provider 混合查询、reload、close 验证，报告同样保存在仓库同级目录。
- 文档测试移到根 `test/website`，固定材料移到 `test/fixtures/website`，验证工具移到 `scripts/validation/website`。站点生成片段、制品、临时消费者、截图与报告位于仓库同级 `capability-graph-artifacts`；Docs CI 同步输入路径并增加 Firefox/WebKit 代表性冒烟。

以上为仓库中的未发布改动，不能据此认为 Registry 的 `1.0.1` 或公网站点已经更新。Core 变化须走新版本的包发布，再部署匹配文档；保留现有发布、防回退和制品身份校验。

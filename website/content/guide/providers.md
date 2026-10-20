# Provider 与能力声明

你维护的是“已有能力的说明书”。先为每项真实能力分配稳定 ID，写清它适合什么任务，再按需要补使用说明、适用条件、关系和关联材料。Graph 校验这些声明，不扫描源码猜测功能，也不会执行能力。

## 先让一项能力可被发现

例如给应用中的请求校验功能建立最小来源，保存为 `provider.json`：

```json
{
  "providerId": "acme",
  "name": "Acme application",
  "version": "1",
  "capabilities": [
    { "id": "schema", "name": "Request validation", "description": "Validate a JSON request body before the handler runs." }
  ]
}
```

在已安装本包的项目目录运行 `npx --no-install capability-graph validate --file provider.json`。这检查声明是否合法，不证明外部框架已经安装或实际校验有效。首次打开和查询步骤见[第一个图谱](/getting-started/quick-start)。

## 按用户需要逐步补字段

| 想解决的问题 | 添加什么 | 写法与边界 |
| --- | --- | --- |
| 用户不知道该不该选它 | name / description / whenToUse | 说明任务、对象和限制，让目录阶段就能判断；不把关键选择条件藏在长文里 |
| 选中后不知道怎么调用 | usage.instructions / input / output / examples | 写实际操作、参数含义、返回和可运行例子；这些是文字说明，不是回调 |
| 已有接口或工具契约 | usage.contract | format只能是openapi/mcp-tool/json-schema/other；uri为绝对HTTPS或URN，Graph不自动抓取或执行 |
| 仅适用于某个环境 | appliesTo.all | 写调用方能提供的平面事实条件，见[Context](/guide/context) |
| 必须依赖或关联另一能力 | relations | 使用现有四种正向关系，依赖由作者声明，见[关系](/guide/relations) |
| 使用说明太长 | documents | 只放有ID的文件/URL引用；选中后按需读取正文，见[文档](/guide/documents) |

`usage` 的每个字段都是可选的，消费时要处理缺省，见[结果指南](/guide/results)。描述“功能很强，支持各种场景”无法判断；“校验JSON请求体，非法输入在进入处理函数前拒绝；不负责身份认证”说明了对象、时机和限制。`whenToUse` 再补“需要拒绝不符合字段约束的请求时使用”。不要写入未由实际软件验证的承诺。

### 目录和详情的可见范围

`listCatalog`/模型候选目录只包含 `id/providerId/name/description` 和可选 `whenToUse/appliesTo`。`getCapabilities` 或 `resolve` 的能力详情才包含 `usage/relations/documents`，且 documents 此时仍只是引用。`readDocument` 才读取正文；Graph不会在选能力前把usage和长文自动发给模型。

## 字段规则

下表中 `whenToUse` 至 `documents` 均位于 `capabilities[]`，不是Provider顶层字段。

| 字段 | 类型 / 必填 | 缺省及规则 |
| --- | --- | --- |
| schemaVersion | 1 / 否 | 省略允许，不接受其他版本 |
| providerId | string / 是 | 小写字母开头，后续小写字母/数字/点/下划线/连字符，共 1–128 字符 |
| name | 非空 string / 是 | 展示名称，不能纯空白 |
| version | 非空 string / 是 | 作者声明版本，与 Graph Revision 不同；不强制 SemVer |
| description | string / 否 | Provider 说明 |
| capabilities | CapabilityDefinition[] / 是 | [] 合法；局部 ID 唯一 |
| capabilities[].id | string / 是 | 与 providerId 相同字符约束；定义时为局部 ID |
| capabilities[].name/description | 非空 string / 是 | 名称与能力说明 |
| whenToUse | 非空 string / 否 | 推荐填写，帮助目录阶段选择 |
| usage | object / 否 | instructions/input/output 为 string，examples 为 string[]；是使用说明，不是回调 |
| usage.contract | object / 否 | format 为 openapi/mcp-tool/json-schema/other；uri 为绝对 HTTPS 或 URN |
| appliesTo | object / 否 | all 条件数组，详见 Context 页 |
| relations | object / 否 | parents/specializes/related/requires 的目标 ID 数组；缺省为空 |
| documents | DocumentRef[] / 否 | id、可选 title、source；缺省为空 |

查询与返回使用完整身份 providerId::capabilityId。同 Provider 关系可写局部 ID；跨 Provider 关系必须完整 ID。

所有未知定义字段拒绝；AJV 不做强制转换、删除字段或填充数据。内联 JSON 拒绝函数、getter、Proxy、特殊原型、toJSON、循环、稀疏数组和非有限数，不执行输入上的用户函数。

文件组织可为 providers/acme/provider.json 与 providers/acme/knowledge/guide.md。配置显式指向 provider.json；当前不扫描目录、不合并 capabilities 分文件、不执行 JS 配置。

## 用同一 Schema 描述不同来源

无需为框架、SDK、Tool、Skill、Workflow新增类型字段。包内 `examples/scenarios/provider-patterns.json` 给出四项**声明模式教学样本**，不代表已验证的软件兼容或生产调用代码：

| 模式 | 能力描述重点 | 已有字段表达 |
| --- | --- | --- |
| 框架 / SDK | 实际调用任务、输入输出、依赖的框架版本 | usage文字、appliesTo；已有HTTP契约可引用openapi |
| 已有 Tool | 工具解决的问题、真实工具名和参数契约 | usage.instructions和contract.format:mcp-tool，不动态注册工具 |
| 已有 Skill | 适用任务、载入位置、使用步骤与限制 | usage文字；已有材料可用documents或contract.format:other，不存在format:skill |
| Workflow | 组合目标和明确前置能力 | instructions、requires；Graph不调度步骤、不按节点排序执行 |

按[运行示例](/examples/index)复制后，在项目根运行：

```sh
npx --no-install capability-graph validate --file examples/scenarios/provider-patterns.json
```

该命令应成功校验现有Schema。未知 `kind/type/tags/callback` 等字段拒绝；不要为描述模式伪造新字段。教学URN只用于说明合法引用格式，实际接入须替换为你的真实契约。

## 新增与更新的维护步骤

1. 新来源创建独立Provider JSON和唯一providerId；新增能力保留已有ID含义，语义变更评估对调用方的影响。
2. 明确依据的软件/SDK版本、作者和覆盖范围；更新可见目录描述、usage、条件和文档引用，不把Provider.version当Graph版本。
3. 新关系先确认目标ID和授权：跨来源写完整ID，同类非法环或已加载来源中错误目标会在加载时拒绝。
4. 运行CLI validate，再以SDK打开全部相关来源，查询真实ID，检查完整结果；框架实际运行另做消费者验证。
5. 仅更改已配置文件可调用reload并检查ok；新增/删除来源或改变授权需重新open。内联对象按值加载，修改原对象后reload仍读旧副本。

一个Provider目前只有一份声明文件。作者可在自己的构建流程从已知元数据生成这份纯JSON，但Graph不扫描或合并分文件，也不推断源码行为。[生命周期](/guide/lifecycle)解释更新失败与跨请求版本变化。

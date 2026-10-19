# Provider 与能力声明

静态来源只有 file 或 definition，两者互斥。同一个 Graph 可加载多个来源；providerId 不能重复。file 的文档根为 JSON 文件所在目录。definition 必须是纯 JSON 值，含本地文档时显式指定可信 documentRoot。

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

完整最小文件在[快速开始](/getting-started/quick-start)。

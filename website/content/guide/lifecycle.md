# Revision、重载与关闭

open 创建私有不可变 Snapshot，返回值为独立 JSON 副本，修改输入/结果不会影响内部图。一次查询或 match 捕获一个快照。

| 标识 | 含义 |
| --- | --- |
| Provider.version | 作者声明版本 |
| meta.revision | 授权静态定义规范化内容的 sha256，不含绝对路径/文档正文/Context/模型状态 |
| contentHash | 某次文档读取的原始字节哈希 |

能力/关系目标的集合顺序改变不改变 Revision，语义有序 examples 顺序会改变。未授权 Provider 的更新不改变授权视图 Revision。跨请求若 Catalog 与 Resolve Revision 不同，宿主应刷新目录重新选择。

## 原子 reload

```js
const update = await graph.reload();
if (!update.ok) console.error(update.error, update.providers);
```

可指定已有 providerId；文件重新读取，内联仍使用 open 时副本。所有候选及合并图验证通过才一次发布；失败保留旧快照。Provider 身份不能通过 reload 改变；增删来源配置需重新 open。

状态 updated 表示新快照已生效，unchanged 表示内容相同，failed 表示来源本身失败，not_applied 表示候选可用但该次 reload 未提交。全局组合环等错误不把任何变更标 updated。输出只包含授权 Provider。

reload 串行，match 等待模型期间 reload 不改变本次选择与解析所用 Snapshot。

## close 与所有权

Graph.close 幂等，拒绝新工作并取消活动 match；已开始的静态操作可以按其快照完成。Graph 不销毁调用者的 executor。

MCP Server 与 Tool Adapter 借用 Graph：先关闭服务/连接，再由创建 Graph 的应用关闭 Graph。server.close 只关自身传输；同一关闭后的服务对象不能重启，必要时新建对象。

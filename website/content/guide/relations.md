# 关系与多个 Provider

一个 Graph 的 providers 数组可配置多个 file 或 definition；每个 Provider 的关系进入统一索引。授权由 open.allowedProviders 固定，查询只能缩小范围。

| 声明方向 | 反向查询名 | 含义 |
| --- | --- | --- |
| parents | children | 分类/从属 |
| specializes | specializedBy | 专门化 |
| related | relatedBy | 相关能力 |
| requires | requiredBy | 作者明确声明的必要依赖 |

反向关系由索引构建，不能写入 JSON。parents、specializes、requires 各自禁止环；related 可有环。已加载 Provider 内不存在的目标会导致加载失败；未加载外部 Provider 的引用可保留。

## 解析范围

resolve 默认 relations:['requires']，展开根的 requires 传递闭包。显式 [] 只取根；其他正/反向关系从根一跳，不自动展开所到关联节点的依赖。null 不是省略，会报 CG_INPUT_INVALID。

selected 保留根顺序，输出节点/边稳定排序去重。节点 origin 优先级 selected > dependency > relation。边总是原始正向方向。

跨 Provider 目标已加载且授权时正常展开；未加载或无权限统一为 target_unavailable，放入 unresolved，meta.completeness 为 partial。隐藏反向来源不产生可探测计数或 partial。显式查询越权根整次失败。

完整跨 Provider 代码见[多个 Provider 示例](/examples/multi-provider)。关系是作者的声明，不是框架扫描或模型推测的事实。

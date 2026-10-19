# Context 与适用条件

Context 是调用方明确提供的环境事实，不是授权。Graph 不扫描仓库补齐事实。

```json
{"facts":{"framework":"vextjs","framework.version":"2.0.0","production":true},"notes":"Only the supplied facts are known."}
```

facts 是平面映射，值只能是 string、有限 number 或 boolean。点号是键名的一部分，不访问嵌套对象；null、数组、对象等不合法。notes 仅给模型参考，不进入确定性适用判断。

```json
{"appliesTo":{"all":[{"field":"framework","op":"eq","value":"vextjs"},{"field":"framework.version","op":"semverRange","range":">=2.0.0 <3.0.0"}]}}
```

| 条件 | 定义与边界 |
| --- | --- |
| eq | 严格同类型等值，不把 1 与 '1' 等同 |
| in | values 为标量数组；空数组合法，对已提供的事实均不匹配 |
| semverRange | 稳定 major.minor.patch，支持精确版本或空格 AND 连接的 =/>/>=/</<=；不支持 ^/~/*/或、预发布、build metadata、前导零 |

无 appliesTo 或 all:[] 为 applicable。已知条件不满足时为 inapplicable，优先于同时存在的缺失信息；否则缺失/非法版本事实为 unknown。返回 missingFacts/invalidFacts/failedConditions。

getCapabilities 与 resolve 都保留不适用或未知节点。match.status、节点 applicability 与 graph.meta.completeness 分开看：matched 可以同时 unknown 或 partial，不能直接等同可执行。

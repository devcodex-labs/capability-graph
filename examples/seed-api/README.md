# 普通 API 参考

从仓库根目录运行 `npm test`，然后运行 `node dist-test/examples/seed-api/main.js`。

本例通过主包公开入口加载 `examples/seed-provider`，取得 Provider 元数据和目录，再选择路由校验、检查关系、显式补选请求 Schema，读取 D-02 与 D-03。不会自动读取 D-01 或 `PROVIDER.md`，也不会启动业务服务。

`runSeedTask` 可由接入方传入 Runtime Adapter、项目和环境；不传时只执行真实静态/本地知识流程，不将缺 Runtime 解释为“没有实例”。测试 Fixture 仅位于 `test/contract`，不作为此示例的生产依赖。

能力 JSON 变化后调用 `graph.reload()`；新定义校验失败时保留旧视图并返回刷新失败状态。正文变化不需要重新加载，下一次直接读取重新计算内容身份。指定旧静态修订只允许当前或上一成功视图，不支持任意历史快照。

# 普通 API 参考

从仓库根目录运行 `npm test`，然后运行 `node dist-test/examples/seed-api/main.js`。

本例通过主包公开入口加载 `examples/seed-provider`，取得 Provider 元数据和目录，再选择路由校验、检查关系、用 `resolveSelection()` 展开必要上下文、按角色与语言读取已选文档，并以 `readSpecification()` 单独读取 `SPEC-01`。不会自动读取其他知识，也不会启动业务服务。

`runSeedTask({ rootDir? })` 加载文件 Provider，执行目录、详情、邻居、Selection、文档和规范读取，并在 finally 关闭图谱。业务状态查询由宿主自己的 API 管理。

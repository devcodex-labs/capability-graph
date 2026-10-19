# VextJS 案例


依据 npm 官方 `vextjs@2.0.0` 的 README、`defineRoutes`、`RouteOptions` 和 `vextjs/testing` 类型编写。来源：https://www.npmjs.com/package/vextjs/v/2.0.0 和 https://github.com/devcodex-labs/vextjs 。此声明由案例作者维护，不代表 VextJS 自动生成或官方承诺的完整能力集合。

`greeting.create` 是本例组合流程，明确依赖 `route.post` 和 `validation.body`。普通 VextJS 路由可以没有 body 校验；这里的 requires 只描述这个 greeting 流程，不把可选功能说成框架普遍依赖。

在你的 ESM 项目中安装依赖并复制示例，然后运行：

```sh
npm install @devcodex/capability-graph@2.0.0 vextjs@2.0.0
cp -R node_modules/@devcodex/capability-graph/examples ./examples
node examples/vextjs/resolve.mjs
node examples/vextjs/verify.mjs
```

resolve 只读取声明，返回三节点图。verify 单独运行真实 VextJS 的 `createTestApp`，注册 `routes/hello.ts`，检查有效请求返回 greeting、空 name 返回 422，并关闭 App。422 与 2.0.0 的公开 ValidationError 类型约定一致。Graph 不加载或执行该路由。临时测试项目放在 `CG_ARTIFACTS_DIR` 或系统临时目录，临时 node_modules/vextjs 链接到该消费者真实安装的 VextJS。


## 范围

该 Provider 只描述三项示例能力。接入自己的 VextJS 项目时，按实际版本补充目录、usage、documents 和 appliesTo；关系由 Provider 作者声明。Graph 负责选择结果的校验与依赖解析，实际路由由应用创建和执行。

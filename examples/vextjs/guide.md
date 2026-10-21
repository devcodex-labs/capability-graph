# VextJS 2.0.0 案例

依据 npm 官方 `vextjs@2.0.0` 的 README、`defineRoutes`、`RouteOptions` 和 `vextjs/testing` 类型编写。来源：https://www.npmjs.com/package/vextjs/v/2.0.0 和 https://github.com/devcodex-labs/vextjs 。此声明由案例作者维护，不代表 VextJS 自动生成或官方承诺的完整能力集合。

`greeting.create` 是本例组合流程，明确依赖 `route.post` 和 `validation.body`。普通 VextJS 路由可以没有 body 校验；这里的 requires 只描述这个 greeting 流程，不把可选功能说成框架普遍依赖。

先在你的 ESM 项目中运行普通图谱示例，Node20.19+（20.x）或22.12+即可；Node20使用本库v2.1.0起的版本：

```sh
npm install @devcodex/capability-graph
cp -R node_modules/@devcodex/capability-graph/examples ./examples
node examples/vextjs/resolve.mjs
```

真实框架验证额外要求Node22.12+，再安装框架并运行；Node20只执行上面的图谱解析，不执行此命令：

```sh
npm install vextjs@2.0.0
node --experimental-strip-types examples/vextjs/verify.mjs
```

resolve 只读取声明，返回三节点图。verify 单独运行真实 VextJS 的 `createTestApp`，注册 `routes/hello.ts`，检查有效请求返回 greeting、空 name 返回 422，并关闭 App。422 与 2.0.0 的公开 ValidationError 类型约定一致。Graph 不加载或执行该路由。临时测试项目放在 `CG_ARTIFACTS_DIR` 或系统临时目录，临时 node_modules/vextjs 链接到该消费者真实安装的 VextJS。

Node22.12.0需显式--experimental-strip-types加载随附TS路由；这是该版本实验性类型剥离功能。createTestApp使用真实框架处理链及内存模拟请求，不监听TCP端口；该检查不代替真实部署和宿主接入验证。

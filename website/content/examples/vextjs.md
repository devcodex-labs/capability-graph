# VextJS 案例


依据 npm 官方 `vextjs@2.0.0` 的 README、`defineRoutes`、`RouteOptions` 和 `vextjs/testing` 类型编写。来源：https://www.npmjs.com/package/vextjs/v/2.0.0 和 https://github.com/devcodex-labs/vextjs 。此声明由案例作者维护，不代表 VextJS 自动生成或官方承诺的完整能力集合。

`greeting.create` 是本例组合流程，明确依赖 `route.post` 和 `validation.body`。普通 VextJS 路由可以没有 body 校验；这里的 requires 只描述这个 greeting 流程，不把可选功能说成框架普遍依赖。

在你的 ESM 项目中安装依赖并复制示例，然后运行：

```sh
npm install @devcodex/capability-graph vextjs@2.0.0
cp -R node_modules/@devcodex/capability-graph/examples ./examples
node examples/vextjs/resolve.mjs
node --experimental-strip-types examples/vextjs/verify.mjs
```

resolve 只读取声明，返回三节点图。verify 单独运行真实 VextJS 的 `createTestApp`，注册 `routes/hello.ts`，检查有效请求返回 greeting、空 name 返回 422，并关闭 App。422 与 2.0.0 的公开 ValidationError 类型约定一致。Graph 不加载或执行该路由。临时测试项目放在 `CG_ARTIFACTS_DIR` 或系统临时目录，临时 node_modules/vextjs 链接到该消费者真实安装的 VextJS。


## 范围

该 Provider 只描述三项示例能力。接入自己的 VextJS 项目时，按实际版本补充目录、usage、documents 和 appliesTo；关系由 Provider 作者声明。Graph 负责选择结果的校验与依赖解析，实际路由由应用创建和执行。

## 运行前分清两项验证

| 命令 | 依赖与输入 | 成功说明 |
| --- | --- | --- |
| node examples/vextjs/resolve.mjs | 本库、随附vextjs.capabilities.json；显式facts含framework:vextjs和字面版本键 | 完整ResolveResult：greeting.create根及route.post/validation.body依赖、applicable、complete；只证明声明解析 |
| node --experimental-strip-types examples/vextjs/verify.mjs | 另装真实vextjs@2.0.0，随附routes/hello.ts，可写临时目录 | 真实createTestApp注册POST /hello，name:Ada返回200及greeting，空name返回422，最后关闭App |

第二项不是第一项自动执行的依赖。未安装框架或无法运行测试应用时，单列该项未验证；不能用Graph三节点结果宣称整个VextJS兼容。声明中的usage.input/output/examples用于解释greeting组合任务，不是完整框架能力清单。

Node 22.12.0需显式开启上面的类型剥离标志，才能加载随附hello.ts；它是该Node版本的实验性功能，见[官方CLI文档](https://nodejs.org/download/release/v22.12.0/docs/api/cli.html#--experimental-strip-types)。这里仅使用可剥离的类型断言，不要求新增TS加载依赖。createTestApp使用真实框架处理链及内存请求模拟，不监听TCP端口；它验证框架路由行为，不等于远程HTTP部署验收。

PowerShell复制示例见[运行示例](/examples/index)。Node最低版本、当前锁定框架版本与实际输出应分别记录；更换框架版本后由声明作者重新核对路由/校验API、条件范围和说明。

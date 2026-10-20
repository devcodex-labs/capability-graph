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

## 分清五种版本与更新方式

| 标识 | 维护方与用途 |
| --- | --- |
| npm包版本 | 本库发布版本，来自package.json |
| Provider的schemaVersion | 声明格式版本，当前可省略或为1；不是软件版本范围 |
| Provider.version | 声明作者给来源的非空版本字符串，不强制SemVer |
| meta.revision | 授权静态图谱视图；不覆盖知识正文或Context |
| contentHash | 一次读取的原始知识字节；与Graph revision分开 |

没有默认文件监听。已配置文件改变后显式reload；新增/删除来源、调整授权或模型配置需要重新open。内联对象按值复制，修改原JS对象后reload仍读取原副本。不要发明softwareVersion/versionRange字段。

## 可运行的快照与失败恢复

按[运行示例](/examples/index)复制后运行 `node examples/scenarios/lifecycle.mjs`。脚本只创建并清理自己的系统临时目录，使用受控等待executor，不调用真实模型。执行顺序是：

1. 在旧目录视图中开始match，让受控选择暂时等待。
2. 修改文件并reload成功，然后让旧match返回；断言其目录和依赖解析仍用旧revision。
3. 再次读取Catalog得到新revision。跨请求Catalog→Resolve或详情若revision不同，应刷新目录、重新选择；API没有expectedRevision参数，也不自动抛CG_REVISION_MISMATCH。
4. 一个候选有效但另一来源损坏时reload.ok:false，旧快照保留；修复后重试发布。合并后出现跨来源requires环同样整次不提交。
5. 分别触发close、外部abort、timeout，核对code/phase及executor收到的signal；重复close合法。

其中一次更新和一次失败的实际完整reload结果：

```json
{
  "updated": {
    "ok": true,
    "revision": "sha256:f84617eec78c2dcc7ee4efad20065519464d6bd1e7a86bde680255b6c726c113",
    "providers": [
      {
        "providerId": "a",
        "status": "updated"
      },
      {
        "providerId": "b",
        "status": "unchanged"
      }
    ]
  },
  "failed": {
    "ok": false,
    "revision": "sha256:f84617eec78c2dcc7ee4efad20065519464d6bd1e7a86bde680255b6c726c113",
    "providers": [
      {
        "providerId": "a",
        "status": "not_applied"
      },
      {
        "providerId": "b",
        "status": "failed",
        "error": {
          "code": "CG_DEFINITION_INVALID",
          "message": "Cannot read a valid UTF-8 JSON Provider source"
        }
      }
    ],
    "error": {
      "code": "CG_RELOAD_FAILED",
      "message": "One or more Provider sources failed validation"
    }
  },
  "combinedCycle": {
    "ok": false,
    "revision": "sha256:98e01d0f6fbbda2be1961feb187f539f4e3af66ee009c6acc2417e91ca40128f",
    "providers": [
      {
        "providerId": "a",
        "status": "unchanged"
      },
      {
        "providerId": "b",
        "status": "not_applied"
      }
    ],
    "error": {
      "code": "CG_RELATION_CYCLE",
      "message": "Cycle in requires relations"
    }
  }
}
```

`updated`只在实际发布后出现；`unchanged`内容相同；`failed`是来源本身失败；`not_applied`是候选已通过但整个事务未提交。合并图失败时可能没有来源标failed，要同时检查顶层ok/error。

终止实际结果为：

```json
{
  "close": {
    "code": "CG_GRAPH_CLOSED",
    "phase": "lifecycle",
    "executorSignalAborted": true
  },
  "abort": {
    "code": "CG_MODEL_CANCELLED",
    "phase": "match",
    "executorSignalAborted": true
  },
  "timeout": {
    "code": "CG_MODEL_TIMEOUT",
    "phase": "match",
    "executorSignalAborted": true
  }
}
```

Graph停止等待并中止传给executor的signal，不替应用关闭借用的客户端、连接池或不合作的任务。executor负责自己的资源清理；创建它的应用决定何时销毁共享资源。Graph.close不是关闭模型账号或宿主进程。

<details>
<summary>查看完整快照、reload与终止验证脚本</summary>

<!-- example:examples/scenarios/lifecycle.mjs -->
```js title="lifecycle.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

// This example creates only its own temporary directory and removes it in finally.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capability-graph-lifecycle-'));
const a = {providerId:'a',name:'Application',version:'1',capabilities:[{id:'route',name:'Route',description:'Original route.',relations:{requires:['b::schema']}}]};
const b = {providerId:'b',name:'Validation',version:'1',capabilities:[{id:'schema',name:'Schema',description:'Request schema.'}]};
let graph, releaseSelection, markStarted;
const started = new Promise(resolve => { markStarted = resolve; });
const output = {};
try {
  await fs.writeFile(path.join(root,'a.json'),JSON.stringify(a));
  await fs.writeFile(path.join(root,'b.json'),JSON.stringify(b));
  graph = await CapabilityGraph.open({providers:[{file:path.join(root,'a.json')},{file:path.join(root,'b.json')}],model:{
    id:'controlled-snapshot-demo',async select(request) {
      markStarted(request.revision);
      return new Promise(resolve => { releaseSelection = () => resolve({decision:'selected',ids:['a::route']}); });
    }
  }});
  const before = await graph.listCatalog();
  const matching = graph.match({input:'Demonstrate a fixed snapshot'});
  assert.equal(await started,before.meta.revision);
  a.version='2';a.capabilities[0].description='Updated route.';
  await fs.writeFile(path.join(root,'a.json'),JSON.stringify(a));
  output.updated = await graph.reload();
  assert.deepEqual(output.updated.providers.map(item=>item.status),['updated','unchanged']);
  releaseSelection();output.match = await matching;
  assert.equal(output.match.graph.meta.revision,before.meta.revision);
  assert.equal(output.match.graph.nodes.find(node=>node.capability.id==='a::route').capability.description,'Original route.');
  output.current = await graph.listCatalog();assert.notEqual(output.current.meta.revision,before.meta.revision);
  a.version='3';await fs.writeFile(path.join(root,'a.json'),JSON.stringify(a));
  await fs.writeFile(path.join(root,'b.json'),'not JSON');
  output.failed = await graph.reload();
  assert.equal(output.failed.ok,false);assert.deepEqual(output.failed.providers.map(item=>item.status),['not_applied','failed']);
  assert.equal((await graph.listCatalog()).meta.revision,output.current.meta.revision);
  await fs.writeFile(path.join(root,'b.json'),JSON.stringify(b));
  output.repaired = await graph.reload();assert.equal(output.repaired.ok,true);
  // Each source is valid alone, but their newly combined requires edges form a cycle.
  b.capabilities[0].relations={requires:['a::route']};
  await fs.writeFile(path.join(root,'b.json'),JSON.stringify(b));
  output.combinedCycle = await graph.reload();assert.equal(output.combinedCycle.ok,false);
  assert.equal(output.combinedCycle.error.code,'CG_RELATION_CYCLE');
  assert(output.combinedCycle.providers.every(item=>item.status!=='updated'));
} finally {
  releaseSelection?.();await graph?.close();await fs.rm(root,{recursive:true,force:true});
}
const inlineDefinition={providerId:'inline',name:'Inline',version:'1',capabilities:[{id:'route',name:'Route',description:'Inline route.'}]};
const inline=await CapabilityGraph.open({providers:[{definition:inlineDefinition}]});
try {
  inlineDefinition.version='2';output.inlineReload=await inline.reload();
  assert.equal(output.inlineReload.providers[0].status,'unchanged');
} finally {await inline.close();}
for(const mode of ['close','abort','timeout']) {
  let begin,signal;const entered=new Promise(resolve=>{begin=resolve;});
  const pending=await CapabilityGraph.open({providers:[{definition:inlineDefinition}],model:{id:'termination-demo',async select(request){signal=request.signal;begin();return new Promise(()=>{});}}});
  const controller=new AbortController();
  const operation=pending.match({input:'Demonstrate termination'},{signal:controller.signal,timeoutMs:mode==='timeout'?50:60000});
  const observed=operation.catch(error=>error);
  try {
    await entered;
    if(mode==='close')await pending.close();
    if(mode==='abort')controller.abort();
    const error=await observed;assert(error instanceof GraphError);
    assert.equal(error.code,{close:'CG_GRAPH_CLOSED',abort:'CG_MODEL_CANCELLED',timeout:'CG_MODEL_TIMEOUT'}[mode]);
    assert.equal(error.phase,mode==='close'?'lifecycle':'match');assert.equal(signal.aborted,true);
    output[mode]={code:error.code,phase:error.phase,executorSignalAborted:signal.aborted};
  } finally {await pending.close();await pending.close();}
}
console.log(JSON.stringify(output,null,2));
```

</details>

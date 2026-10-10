# VextJS 官方文档与运行证据接入

本例的 `documentation-provider.mjs` 按官方文档主题生成 `routing`、`plugins`、`database` 等能力 ID。`capabilities/` 保存 JSON 定义，`knowledge/` 按官方目录层级保存逐字节一致的 Markdown/MDX 正文，`metadata/` 保存来源清单与原生编号关联。内核没有 VextJS 依赖；这些导出器属于源码示例，不属于 Core npm 导出。

主题与章节的关联由集成作者维护，一项能力可以绑定指南、API、规范与示例。固定快照有 91 篇 Markdown/MDX，关联到 46 个主题能力；5 篇导航/资源材料明确归为 reference-only。新增未分类章节或缺失必需章节会阻止导出，避免更新后静默漏项。来源更新应重新导出并 reload，按 Provider invalidate/rebuild 检索索引。导出必须写入新的仓库外目录，同来源导出内容稳定。

`native-provider.mjs` 单独处理原生 MCP schema 2 的审计，保留 73 个条目的身份、kind、status、正文与 digest。该验证目录的 `native.c03` 等 ID 不进入公开文档 Provider；原生正文按原字节存成 Markdown，目录 JSON 和来源信息位于 metadata/。capability、rule、recipe、knowledge、workflow 都保留原生角色，不能据此声称 Core 可执行 Recipe。relatedIds 不推导 requires，vext:// 仅保留为原生来源引用。

原生 MCP 没有分页枚举全部 knowledge 的资源。验证入口从固定安装快照的 `dist/assistant/catalog.js` 读取发现材料，随后通过原生 MCP 回读全部条目并核对目录 digest/身份/正文。这是特定 schema 2 的接入边界，不能假定任意未来版本都支持。接入方也可以提供经过固定来源核验的目录 JSON。

首次使用请按[站点完整接入步骤](../../website/docs/examples/vextjs-integration.mdx#首次接入官方文档-provider)取得固定源码、导出 Provider 并用实际安装的 Core 分页读取。它是有前置条件的可运行源码示例；根 `npm test` 只验证默认接入合同。进一步真实验证要求已安装且固定的 VextJS 快照，以及该快照可检查的实际项目；占位路径须替换为外部目录：

```bash
node scripts/validation/vextjs-documentation.mjs /external/fixed-vextjs SOURCE_ID
# 原生 MCP 的独立审计
node scripts/validation/vextjs.mjs /external/fixed-vextjs /external/project SOURCE_ID
node scripts/validation/vextjs-session.mjs /external/fixed-vextjs
node scripts/validation/vextjs-service-lifecycle.mjs /external/fixed-vextjs redis://127.0.0.1:OWNED_PORT mongodb://127.0.0.1:OWNED_PORT
```

`SOURCE_ID` 使用已核验的完整 Git 提交 SHA；安装快照还必须与该提交的构建输入和输出一致，不能仅用 package.version。入口在根 scripts/；固定检索任务在根 test/fixtures/vextjs/；临时 Provider/应用自动写在仓库同级专用目录并清理。JSON 报告由调用者重定向至仓库外。

`VextNativeRuntimeAdapter` 连接 project identity 与启动快照：停止的实例仍保留 `state=stopped`、`liveness=unverified`、`availability=partial`。没有可信部署来源时 compatibility 为 unknown；不会复制查询 revision 冒充部署证据。原生快照无法证明公开 HTTP、Job 执行或隐藏路由的完整运行图；这些需独立证据。超过原生枚举窗口时拒绝声称完整。

独立检索基线对比原生 MCP 与 CG 词法召回，核对片段字节，报告召回、遗漏、响应量与 P50/P95，模型调用为零。官方文档独立任务固定为 63 条，覆盖全部 46 个主题，包含中文未知需求、否定与组合任务。参考能力检索使用中文词组、词项加权与常见否定处理；这是有限词法参考，未匹配的同义表达仍可能遗漏，当前结果不代表 Agent 成功率。

已单独核验 npm `vextjs@2.0.0`：其 CLI 不包含 `mcp`，因此不能使用原生 schema 2 Provider/Runtime 接入；该发布包的实际 TCP Session/CSRF 场景可另行验证。此原生接入当前适用于固定 main 快照 `ef926649926e17543562b8169982fa1786285ecf`，不把同版本号的发布包视为等价来源。

并行运行不同 Node 版本的上游 dev/cluster 验证时，每个矩阵单元须使用独立的仓库外 `TMPDIR`。VextJS 的进程 owner 注册目录依赖系统临时目录；共享目录会导致验证之间的 owner 冲突。框架构建也须串行或使用独立安装副本。

`.github/workflows/vextjs-ci.yml` 固定源码提交，在 Linux/Windows、Node 20/22/24 上验证全部官方原文、主题检索、原生目录和实际 TCP Session。另一个 Linux 作业在全新安装项目执行 HTTP/MongoDB/Session 业务与 HTTPS 来源验收。框架下载、构建、临时应用及报告均在仓库外。Redis/MongoDB、cluster 和浏览器的扩展验证单独记录，不归为这个兼容矩阵的覆盖内容。

该固定框架在 Windows Node 22.12.0 的源码构建失败：只读诊断确认同一未改变文件的 `lstat.dev=0`，而 `fstat.dev` 为实际设备号，框架将差异判为实现改变；inode、大小、时间与正文均一致。它是该框架的身份检查兼容边界，Core 的 Windows 22.12 回归仍通过。框架 CI 的 Windows Node 22 改用固定补丁 22.23.3；此前失败及诊断保留，未修改框架或绕过检查。已核验的 Windows 20.19.0/24.19.0 也是可用选择。

`node scripts/validation/knowledge-profile.mjs` 可测量实际 HTTP 单篇/多篇正文的冷启动、缓存复核、零命中场景，比较 read-only 与 streaming Reader 的调用、传输量和延迟。该合成工作负载用于比较传输成本，不替代上面的独立检索任务集；每次完整 hash 复核仍可能需要读取整篇正文。


## 1.1.0 来源与目录模式

默认文档导出结构如下；注册时显式 definitionLayout=directory。official-documents.mjs 维护章节清单、主题关联和原生来源映射，不是 Vext 官方能力声明。

```text
providers/
  vextjs/
    provider.json
    capabilities/routing.json
    capabilities/plugins.json
    capabilities/frontend/rendering.json
    knowledge/guide/routing.md
    knowledge/guide/plugins.md
    knowledge/api/route-definition.md
    knowledge/frontend/ssr.md
    metadata/source-manifest.json
    metadata/native-id-map.json
  monsqlize/
    provider.json
    capabilities/documentation.json
  notes-example/
    provider.json
    capabilities/notes.json
```

knowledge/ 中只保存选择落地的官方原文；JSON 仍适合能力定义和来源元数据。其他获准目录、node_modules 安装包以及 HTTP URL 继续使用 locator 直接绑定，不要求复制到 knowledge/。章节清单逐项记录原始路径、固定提交、canonical URL、角色、语言、原文/导出 SHA-256、任务关联和验证范围。完整文档可读取，不表示其中每项框架功能都已实测。

vextjs.mjs 会核验完整 Git SHA、跟踪源未改变、源输入及实际安装 dist 指纹，不能只填 SOURCE_ID 冒充固定来源。直接使用 tarball 安装根时，第四个参数提供匹配的固定源码 checkout。导出器的 contract Fixture 明确标记 caller-declared，不能冒称正式验证。

真实来源矩阵可执行：

```bash
node scripts/validation/provider-sources.mjs /external/fixed-vextjs-source /external/installed-project FIXED_COMMIT --https
```

### 全新实装消费者与真实业务验收

在 Linux、可用 Docker 和已构建的固定 Vext 源码下，下面入口创建全新的仓库外项目，标准打包并实际安装当前 Core 与固定 Vext tarball、lockfile 对应的 MonSQLize。不会使用旧消费者或 node_modules 链接。先安装 Docker 的 `mongo:8.0` 镜像；入口读取其不可变 digest，并记录实际镜像身份。

```bash
npm run build && npm run build:tests
docker pull mongo:8.0
node scripts/validation/vextjs-consumer.mjs /external/built-fixed-vextjs-source ef926649926e17543562b8169982fa1786285ecf --https
```

`--https` 启用两篇真实公开 URL 与 MonSQLize 注册包完整性核验；省略时仅证明 26 个本地来源用例。Core 通过新项目 `node_modules/@devcodex/capability-graph` 的公开入口执行，并逐文件核对实际安装内容。参考 Reader/词法检索器复制到外部应用，保留源码路径和哈希；不是主包的新导出。原有 28 来源/53 页矩阵和 73 原生条目回读使用这份实装 Core 再验证。

文档验收核对全部 91 篇原文与复制字节，对 86 篇任务关联文档通过消费者 Core 逐页完整还原；5 篇参考资料单列，不宣称有任务执行证据。独立主题检索任务要求召回对应能力并从指定官方章节取得真实片段，未知需求不得推荐。原生 MCP 的 73 条目另行审计。

业务验收串联能力召回、显式 Selection、requires 闭包、原文读取与知识片段，再通过公开 bootstrap 启动实际 TCP 应用。notes-example 是独立业务 Provider，requires 描述业务内的路由、输入校验、服务、插件、持久化和会话保护步骤；宿主再显式选择 VextJS 的 routing、validation、services、plugins、database、cookies-session 六项主题。Core 的关系限于同一 Provider，跨 Provider 组合通过宿主选择，不创建跨 Provider requires。笔记业务覆盖 schema 转换和拒绝、插件依赖/ready/LIFO close、MonSQLize 真实写入及数据库分页、独立 MongoDB 驱动读回、Session/CSRF/logout。业务步骤由集成作者依据本应用声明，不冒称原生框架推断。

入口只控制本次创建的本机 MongoDB 容器：停库后请求须报错，停库启动须失败，新实例在重启后须读回原数据。还验证 reload 的旧索引拒绝及重建、文档漂移与旧游标、HTTP 强/弱 ETag、无快照及超缓存预算、实际取消/超时后的恢复和端口释放。恢复使用新应用实例，不承诺在途请求透明恢复。

默认输出为仓库同级 capability-graph-artifacts/vextjs-e2e-*/，也可用 CG_ARTIFACTS_DIR 指定专用仓库外父目录；保留 app/、lockfile、archives/、logs/、reports/verification.json 和各阶段结果。业务与框架定义在 app/providers/；原生审计、文档漂移、受控 HTTP 材料在独立 verification/，不混入 VextJS 文档 Provider。成功或失败都清理自建容器及匿名卷。再次运行创建新批次，报告明确区分 passed/failed，默认 npm test 不会启动 Docker。

保留的 `app/` 含真实 routes/services/plugins 和 `npm start` 入口。另提供自己拥有的 MongoDB，通过 `VEXT_CONSUMER_MONGO_URI` 和可选 `VEXT_CONSUMER_PORT` 配置即可运行业务应用；完整验收仍从仓库入口创建新项目。该阶段的 Linux 本机证据不能替代既有兼容矩阵，也不证明 Jobs、SSR、热重载、生产负载或模型/Agent 任务成功。

该项目需实际安装对应 Vext 快照及 MonSQLize。分别注册 providers/vextjs、providers/monsqlize；使用相同本地能力/知识 ID 验证隔离和 reload。覆盖 19 篇官方章节、两个包各三篇 README/CHANGELOG/MIGRATION、一个显式绑定安装目录，以及固定公开 HTTPS 的长文和短文，共 28 个来源用例。每页核对连续字节偏移、全文/本页哈希及续读标记，完整拼接必须等于原始正文。--https 还按 lockfile integrity 下载 MonSQLize 注册包并核对安装文档原字节。默认 CI 用已由 npm ci 核验的安装依赖执行本地矩阵；公开 HTTPS opt-in 实测单独记录。

每条记录含原始路径/URL、commit 或包身份、角色、语言、转换方式和 SHA-256；官方正文、原生审计、作者关联与受控 Fixture 分开标明。完整安装 Vext 包不包含 website，因此网站指南须另从匹配的官方源码导出、绑定官方目录或固定 raw URL。

原生验证的报告另含 nativeExports：每个条目的原始正文哈希、原生 sourceRefs、Markdown 导出路径、导出哈希、角色及归一化说明。原生简短介绍保留在独立审计目录，不替代完整官方章节。官方章节、安装包文档和 HTTP 正文读取原字节，不经过手写正文替换。旧验证批次保留原有结构作为历史证据；重新运行入口生成新的文档结构。站点的[多来源与正文出处](../../website/docs/examples/vextjs-integration.mdx)说明配置与证明边界。

Core 的 11 个已知检索任务必须召回全部预期能力，未知需求不得误推荐；逐条知识证据必须非零且片段匹配原字节。原生 MCP 的 frontend 基线为 0.5，否定/同义词挑战基线为 0，明确保留上游能力限制而不声称原生全召回。正式文档任务用独立查询/期望文本验收，零命中会失败；不是根据文件名产生查询。

HTTP Reader 可注入 Node 20/22/24 兼容的宿主 ProxyAgent，代理凭据不进入报告。强 ETag 完整快照复用；较大正文的续页可从磁盘只读所需块，由 Core 用首次扫描的分块哈希独立验证。弱/无验证器、证明不可用或超磁盘快照预算回退全文流式扫描。快照在宿主指定的仓库外目录，Reader close 等待在途读取并清理自有子目录。参考词法索引超过字节/条目预算时流式 Top-K，不拒绝大文档。以上为源码参考，主包不导出专用 Vext/HTTP 后端。

URL 使用相同分页接口和原始 UTF-8 字节偏移；无需更换 Core 分段算法。当前 Reader 不依赖 HTTP Range，首次完整核验正文，续页核验强来源证明和实际范围字节，正文改变拒绝旧游标。弱/无验证器、证明不可用或磁盘快照无法保留全文时，每页可能重新传输整篇正文；缓存预算控制保留成本，不是文档准入门槛。

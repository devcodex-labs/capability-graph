# 未发布变更

## Capability Graph V1

- 新增文件权威加载、统一能力校验、正式图、联合目录、按需详情/关系、Provider范围与current/previous静态修订。
- 新增本地知识读取，以及数据库权威、能力召回、知识检索和Runtime合同、预算、返回证据与失败语义。
- 新增真实Seed、普通API、独立私有MCP示例和Node.js HTTP Runtime参考；真实路由采集与静态能力分离。
- 持续补充核心/集成与MCP协议测试；独立声明与tarball消费持续回归，最低Node验证记录见对应交付报告。
- 修复无关Provider故障扩散、清理异常覆盖业务结果及知识选择失败误分类；单Provider查询新增meta状态。
- 邻居查询新增整页/单项UTF-8预算、warning/partial及六组续取验证；非法HTTP请求目标返回400，不终止服务。
- 标准pack自动清理构建，新增无dist源码快照、残留旧产物和离线消费验证。
- 修复联合能力召回的来源失败隔离及指定修订失效处理，保留候选原始排名；知识检索保留Core投影的诊断，不透出Adapter内部路径。
- 补充公共接口、Adapter合同和关键流程注释，以及贡献者代码约定；新增Runtime超时后迟到拒绝的严格模式回归。
- 修复启用Provider缺Authority的静默空结果、相对来源根随cwd变化、知识证据依赖无关Provider及公开游标无法续查的问题。
- 文件扫描跳过版本控制元数据与已约定的构建/缓存目录；测试和私有MCP示例构建清理旧输出，补来源绑定、游标边界和残留测试回归。
- 真实数据库、向量/RAG及远程知识Reader的具体实现留待后续迭代。版本保持0.0.0，尚未发布；远端验证状态以 [GitHub Actions](https://github.com/devcodex-labs/capability-graph/actions) 的实际运行结果为准。

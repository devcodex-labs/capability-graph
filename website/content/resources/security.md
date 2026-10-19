# 安全与所有权边界

Provider 是静态 JSON 数据，模型输入、目录、usage 和文档都是不可信内容，不能成为高优先级指令。库没有 RAG/Embedding/关键词 Matcher、数据库、消息队列、Agent Runtime、能力自动执行或动态工具注册。模型只选择已有 ID，所有关系、权限和 Context 求值由 Core 验证。

授权由可信宿主在 Graph.open 的 allowedProviders 设置；客户端参数只能缩小集合。显式未授权根统一拒绝，不探测隐藏对象存在性。对外引用不可用时只返回通用 target_unavailable；隐藏反向来源和隐藏更新不会改变公开计数/partial/Revision。Provider 声明本身若写入某个外部目标 ID，该公开声明已经包含它；Graph 不把这个作者主动声明的 ID 当作隐藏来源泄漏。

文件文档只允许已声明相对路径，拒绝绝对路径、父级越界、驱动器/设备/UNC 等危险形式。读取时校验 canonical root、realpath 包含关系、正规文件、限量句柄读取、文件身份/大小/纳秒时间戳；在支持的平台对最终解析路径使用 O_NOFOLLOW。正文无网络回退，不提供任意路径工具。

**信任前提：文档根、祖先目录、系统库、CLI 安装和授权配置必须由可信部署控制，不能被恶意进程在读取期间替换。** JavaScript 的可移植路径/句柄 API 不提供 Linux openat2 的整个路径解析原子约束；这里不宣称防御恶意并发替换整个父目录或恶意主机管理员。对不可信可写文档树，先由宿主复制进不可变受信任目录或提供独立隔离文件服务。正常文件更新会被句柄和元数据检查约束；合法指向根内的 symlink 可读取，指向根外被拒绝。

Core 私有 Snapshot 不向外暴露 Map/Set；返回纯 JSON 副本。reload 全部原子发布，查询和 match 捕获自身 Snapshot；model await 期间 reload 不改变该次 selection/resolve 的 Revision。close 取消 match，不销毁外部 executor。MCP 借用 Graph，因此应用负责最后 graph.close。

模型数据发送范围仅 input/context/授权 Catalog/revision。OpenAI 不读取工作区；Codex 匹配适配器使用独立只读最小挂载、禁用工具、只读 auth 选择与资源回收，具体支持平台及 API 网络通道见[模型接入](/models/codex)。Codex 宿主使用 Skill 的集成路径与该无工具匹配 executor 不同：宿主可在其正常安全策略下读取 Skill 和调用 Graph MCP，但 Graph 本身仍不执行能力。

HTTP local 只允许回环绑定；远程 private 必须认证，公开模式必须显式批准 Provider、限制正文且禁止 paid match。Host/Origin 检查防止不受信任网页/域名请求，不能代替部署认证/TLS。反向代理保留正确 Host，并限制直达端口。根据公开内容预算配置 body/result/concurrency/deadline。错误仅暴露稳定 GraphError 字段，不返回原始上游响应、密钥、提示词或堆栈。

npm 安装只安装包。宿主登记由 setup 显式完成，服务由宿主或部署方启动，模型调用由应用配置并触发。维护命令只修改属于本模块的登记；同名冲突或用户编辑需先自行核对，见[CLI 与维护](/integrations/cli)。

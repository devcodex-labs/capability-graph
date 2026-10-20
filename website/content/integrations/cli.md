# CLI 命令参考

## 图谱命令

| 命令 | 行为 |
| --- | --- |
| validate --file Provider.json | 校验单 Provider 与自身关系，不代替多 Provider 整体校验 |
| doctor --config graph.config.json | 加载整图、检查服务暴露条件，输出 ok/modelConfigured/modelVerification:'not_run'/toolCount/items/meta；不调用模型 |
| serve --config graph.config.json --transport stdio或http | 启动服务；CLI 覆盖配置中的 transport，未指定则用配置/默认 stdio |

配置相对路径按配置文件目录解析。现有图谱命令失败退出 1，stderr 为安全 GraphError JSON；stdout 为成功结果或 MCP 协议。serve 就绪信息写 stderr，SIGINT/SIGTERM 与 stdio EOF 关闭资源。

## Codex 维护命令

| 命令 | 可选项 | 行为 |
| --- | --- | --- |
| setup --host codex --config 绝对路径.json | --dry-run / --json | 显式登记 Node/CLI/配置绝对路径和 Skill，重复相同操作幂等 |
| doctor --host codex | --json | 检查登记、Skill、实际 MCP 工具发现；不等于真实模型任务成功 |
| doctor --host codex --repair | --dry-run / --json | 恢复仍有拥有权记录的缺失项，不覆盖用户修改 |
| clean --host codex | --dry-run / --json | 删除未修改自有登记和 Skill，不删业务文件 |

host 支持 codex，固定登记名 capability_graph 与 Skill capability-discovery。config 仅 setup 使用，需已有绝对 JSON 路径。未知/重复参数失败；无 repair 的宿主 doctor 不接受 dry-run。

预览不写文件、不启动 MCP、不调用模型；会读取安装文件/配置并检查可观察前置条件。实际 doctor 会临时启动登记服务列工具，结束关闭进程。安装命令不自动执行维护。

JSON 报告含 command、status、changed、checks、paths、warnings。checks 每项 name/status/message，状态 pass/fail/skipped；顶层 status 为 ok/planned/conflict/failed；changed 只反映实际修改，预览时 changed 为 false。成功/完整预览退出 0，启动/配置读取失败 1，参数无效 2，拥有权或用户编辑冲突 3。此退出规则不改变原 doctor --config。

维护只修改目标 MCP 表、Skill 和用户 .capability-graph/ 拥有权状态。其他配置与用户编辑不覆盖。内联/嵌套/数组的同名 TOML 布局、未知 symlink、同名非自有项会冲突；可先人工整理后再显式登记。中断留下的锁或无法安全回滚的事务需要查看状态，不能靠强制覆盖处理。

更新包后若安装路径改变，显式重跑 setup，再重载宿主。clean 不强制结束正在运行的宿主会话。

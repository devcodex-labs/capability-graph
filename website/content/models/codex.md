# 独立 Codex CLI 匹配

本页用于 Node.js 应用主动调用 match。普通 Codex 用户复用当前模型请走[宿主接入](/integrations/codex)，无需为该路线建立独立匹配进程。

当前支持已验证的 Linux + bubblewrap + 原生 Codex CLI 0.163.0。不使用 Codex SDK，不接管桌面当前会话。不支持的平台/版本/隔离条件报 CG_MODEL_EXECUTOR_UNSAFE，不降级到无隔离运行。

1. 安装固定版本原生 CLI 与 bubblewrap，准备只含可信 CLI 资源的 runtimeRoot。
2. 用独立 CODEX_HOME 运行该 CLI 的 login --device-auth，浏览器授权后 login status 检查。authHome 由你管理，不复制登录文件进项目。
3. 创建独立 scratchRoot，传入 createCodexExecutor，并配置 Graph.open 的 model。完整调用见 match 页。

| 字段 | 默认与说明 |
| --- | --- |
| command | 省略查 PATH 的 codex；建议显式原生文件绝对路径 |
| runtimeRoot | 默认原生文件所在目录；最小可信安装资源根，不包括业务目录或凭据目录 |
| authHome | 默认 CODEX_HOME 或 ~/.codex；推荐专用登录目录，只读绑定 auth.json |
| scratchRoot | 默认系统临时目录下的专用工作空间；部署可显式指定 |
| model | 可选，明确需要时指定 |
| maxOutputBytes | 默认 65536，正安全整数 |

每次匹配新建独立工作目录和 HOME，只读最小挂载，不挂载业务仓库和私有目录。CLI 禁用执行工具/apps/plugins/browser，使用固定候选结构；进程组受取消/超时/输出预算控制，结束清理。API 调用需要网络，不宣称整个 CLI 全部断网。

系统库、证书、可信安装及父目录由部署控制。认证只读绑定不能刷新过期缓存，过期时在专用目录重新登录。云端嵌套沙盒若不能提供 bubblewrap 所需权限，要部署提供隔离运行条件。

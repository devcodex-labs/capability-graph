# 远程 HTTPS 与 ChatGPT Work

远程宿主不能访问开发机 localhost 或你的本地文件树。先在部署环境加载已批准 Provider 和文档，再提供宿主真正可访问的 HTTPS MCP。

## 私有服务

CLI JSON 的 http.access 为 private，非回环监听必须配置 bearer/tokenEnv；SDK 直接传可信 token。反向代理负责 TLS，保留正确 Host 并限制直达端口。宿主需要用户级 OAuth 时使用其支持的网关；本项目不新增 OAuth/RBAC 服务。

```json
{"providers":[{"file":"./provider.json"}],"allowedProviders":["acme"],"transport":"http","http":{"host":"0.0.0.0","port":3333,"path":"/mcp","access":"private","auth":{"type":"bearer","tokenEnv":"CG_HTTP_TOKEN"},"allowedHostnames":["graph.example.com"]}}
```

将 CG_HTTP_TOKEN 配到部署环境，启动 capability-graph serve --config 绝对路径 --transport http。域名为示意，实际部署替换；不将凭据写入 JSON、manifest 或命令行。

## 公开只读服务

access:public-readonly 必须显式 allowedProviders，仅批准公开内容。默认禁正文；publicDocuments:true 才明确批准所有已声明正文。公开匿名始终禁止 enableMatch。Host/Origin 检查与响应/并发/请求预算仍生效。

## 添加宿主连接

在 ChatGPT Work 支持的连接设置中添加 HTTPS 地址和所需认证。宿主必须支持本服务 HTTP 的 2026-07-28 协议，并接受部署端的认证方式；协议或认证方式不兼容时，需要先调整宿主或网关配置。

在新会话请求宿主列出 Provider 和 Catalog，选择一个已声明的能力并调用 Resolve。结果应只包含批准的 Provider，Revision 应一致。若连接失败，依次检查 HTTPS 可达性、MCP 协议、Host/Origin、认证和反向代理路由，见[故障排查](/resources/troubleshooting)。

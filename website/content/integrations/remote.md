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

## 从工作目录到HTTPS的完整材料

准备一台受控服务机、已指向它的真实域名、有效TLS证书、宿主接受的认证方式及兼容MCP协议。以下graph.example.com和证书路径都是待替换示意，不会自动申请域名或创建证书。

部署目录示例：

```text
graph-service/
├── package.json
├── graph.config.json
└── providers/acme/provider.json
```

在该目录安装 `npm install @devcodex/capability-graph`，provider.json使用[最小声明](/getting-started/quick-start)或你批准的实际声明；有知识正文时一并放在对应Provider根下。保存完整graph.config.json：

```json title="graph.config.json"
{
  "schemaVersion": 1,
  "providers": [
    {
      "file": "./providers/acme/provider.json"
    }
  ],
  "allowedProviders": [
    "acme"
  ],
  "transport": "http",
  "enableMatch": false,
  "http": {
    "host": "127.0.0.1",
    "port": 3333,
    "path": "/mcp",
    "access": "private",
    "auth": {
      "type": "bearer",
      "tokenEnv": "CG_HTTP_TOKEN"
    },
    "allowedHostnames": [
      "graph.example.com"
    ],
    "allowedOrigins": [],
    "limits": {
      "maxBodyBytes": 1048576,
      "maxResponseBytes": 20971520,
      "maxInFlight": 32,
      "requestTimeoutMs": 30000,
      "shutdownTimeoutMs": 5000
    }
  }
}
```

此例只让代理访问回环3333，http.access:private仍显式设置bearer。allowedHostnames必须匹配代理转发的真实Host；allowedOrigins:[]拒绝带Origin的跨来源请求，如果合法客户端确实发送Origin，只加入它的精确HTTP(S) origin，不含路径。Host/Origin不是账号认证的替代品。

在服务环境配置CG_HTTP_TOKEN（Bash用 `export CG_HTTP_TOKEN='你的服务凭据'`，PowerShell用 `$env:CG_HTTP_TOKEN='你的服务凭据'`），再从部署目录运行：

```sh
npx --no-install capability-graph doctor --config graph.config.json
npx --no-install capability-graph serve --config graph.config.json --transport http
```

doctor检查配置，不做真实模型验证；serve的stderr报告ready及内部回环地址。内部地址是给代理的，不是远程宿主要填写的URL。

例如已有Nginx/TLS部署可按下面的server块转发，替换域名和已存在证书路径，并先执行部署方的 `nginx -t`：

```nginx
server {
    listen 443 ssl;
    server_name graph.example.com;
    ssl_certificate /etc/ssl/graph/fullchain.pem;
    ssl_certificate_key /etc/ssl/graph/privkey.pem;

    location = /mcp {
        proxy_pass http://127.0.0.1:3333;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_buffering off;
        proxy_read_timeout 80s;
    }
}
```

配置依据Nginx官方[代理模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)及[SSL模块](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)。保留Host、认证与MCP请求头，关闭响应缓冲以转发流式结果。请求预算、代理超时和上游关闭策略需一并配置；这里没有替你部署或完成证书验收。

## 验证远程连接的顺序

1. 从宿主实际可达网络确认 `https://你的域名/mcp` 的证书、域名和路由；普通GET有响应不等于MCP握手成功。
2. 用支持2026-07-28的MCP客户端及同一认证发起工具发现，确认默认五工具。静态接入不需要模型Key。
3. 请求Catalog，确认只包含批准来源及真实ID；再Resolve并检查完整structuredContent、applicability、completeness和revision。
4. 在目标宿主的连接设置填写同一HTTPS URL及其支持的认证；开启新会话检查实际工具调用。宿主只支持OAuth时，需要你自己的合规OAuth网关；固定Bearer不会自动变成OAuth。
5. 缺域名、账号、认证适配或协议支持时，该条真实宿主连接保持未验证；本地JSON合法、代理启动或URL存在不能代替上述成功结果。

401检查凭据与代理Authorization；Host/Origin拒绝核对精确值；协议不兼容先核对双方版本；超时检查Graph/HTTP/代理三个层次。不要统一当网络故障重试。更多见[故障排查](/resources/troubleshooting)。部署服务由其拥有者按实际服务管理方式关闭，客户端close只关闭自己的连接。

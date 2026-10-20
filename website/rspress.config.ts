import path from 'node:path';
import { defineConfig } from '@rspress/core';
import { pluginSitemap } from '@rspress/plugin-sitemap';

const link = (text: string, link: string) => ({ text, link });
const groups = [
  { text: '开始使用', items: [link('产品与接入路线', '/getting-started/introduction'), link('安装', '/getting-started/installation'), link('第一个图谱', '/getting-started/quick-start')] },
  { text: '核心用法', items: [link('按任务查能力', '/guide/capabilities'), link('读取解析结果', '/guide/results'), link('Provider 声明', '/guide/providers'), link('关系与多个 Provider', '/guide/relations'), link('Context 与适用条件', '/guide/context'), link('本地文档与 URL 引用', '/guide/documents'), link('Revision 与生命周期', '/guide/lifecycle'), link('运行示例', '/examples/index'), link('VextJS', '/examples/vextjs')] },
  { text: '集成接入', items: [
    { text: '使用宿主当前模型', items: [link('本地 Codex 客户端', '/integrations/codex'), link('MCP stdio 与 HTTP', '/integrations/mcp'), link('Skill 与 Plugin', '/integrations/skill-plugin'), link('远程 HTTPS', '/integrations/remote')] },
    { text: '嵌入已有程序', items: [link('已有 MCP Server', '/integrations/existing-server'), link('Agent Tool Adapter', '/integrations/tools')] },
    { text: '由应用主动匹配', items: [link('匹配状态与结果处理', '/models/match'), link('OpenAI 与兼容网关', '/models/openai'), link('独立 Codex CLI', '/models/codex'), link('自定义执行器', '/models/custom')] },
  ] },
  { text: '参考与排错', items: [link('完整配置', '/reference/configuration'), link('SDK 方法与结果', '/reference/sdk'), link('公开类型', '/reference/types'), link('CLI 命令参考', '/integrations/cli'), link('错误与恢复', '/reference/errors'), link('故障排查', '/resources/troubleshooting'), link('安全与授权', '/resources/security'), link('版本与兼容', '/resources/compatibility')] },
  { text: '维护者', collapsed: true, items: [link('源码开发与检查', '/resources/development'), link('维护者发版', '/resources/releasing')] },
];
// Keep published entry URLs; their content points to the canonical guide.
const legacyEntries = ['/integrations/overview', '/examples/multi-provider'];
export default defineConfig({
  root: path.join(import.meta.dirname, 'content'),
  base: process.env.CG_SITE_BASE ?? '/capability-graph/',
  outDir: process.env.CG_SITE_BUILD_DIR ?? path.resolve(import.meta.dirname, '../../capability-graph-site-artifacts/site'),
  lang: 'zh', title: 'Capability Graph', logoText: 'Capability Graph', icon: '/favicon.svg',
  description: '用静态 JSON 声明能力，让应用与 AI 宿主发现能力、检查适用条件并解析依赖。',
  plugins: [pluginSitemap({ siteUrl: process.env.CG_SITE_URL ?? 'https://devcodex-labs.github.io/capability-graph' })],
  search: { codeBlocks: true },
  builderConfig: { performance: { buildCache: false } },
  themeConfig: {
    darkMode: true,
    nav: [
      { text: '开始使用', link: '/getting-started/introduction', activeMatch: '^/getting-started/' },
      { text: '核心用法', link: '/guide/results', activeMatch: '^/(guide|examples)/' },
      { text: '集成接入', link: '/integrations/codex', activeMatch: '^/(models/|integrations/(?!cli))' },
      { text: '参考与排错', link: '/reference/configuration', activeMatch: '^/(reference/|integrations/cli|resources/(security|compatibility|troubleshooting))' },
      { text: '维护者', link: '/resources/development', activeMatch: '^/resources/(development|releasing)' },
    ],
    sidebar: { '/': groups },
    socialLinks: [{ icon: 'github', mode: 'link', content: 'https://github.com/devcodex-labs/capability-graph' }],
    footer: { message: 'Apache-2.0 · Capability Graph v2.0.0' },
    lastUpdated: true,
  },
});

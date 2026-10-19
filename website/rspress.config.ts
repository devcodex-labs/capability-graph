import path from 'node:path';
import { defineConfig } from '@rspress/core';
import { pluginSitemap } from '@rspress/plugin-sitemap';

const groups = [
  { text: '开始使用', items: [['产品与接入路线', '/getting-started/introduction'], ['安装', '/getting-started/installation'], ['第一个图谱', '/getting-started/quick-start']] },
  { text: '使用指南', items: [['Provider 声明', '/guide/providers'], ['关系与多个 Provider', '/guide/relations'], ['Context 与适用条件', '/guide/context'], ['关联知识文件', '/guide/documents'], ['Revision 与生命周期', '/guide/lifecycle']] },
  { text: '主动模型匹配', items: [['match 与结果处理', '/models/match'], ['OpenAI 与兼容网关', '/models/openai'], ['独立 Codex CLI', '/models/codex'], ['自定义执行器', '/models/custom']] },
  { text: '宿主接入', items: [['完整接入清单', '/integrations/overview'], ['Codex 便捷登记', '/integrations/codex'], ['MCP stdio / HTTP', '/integrations/mcp'], ['已有 MCP Server', '/integrations/existing-server'], ['Agent Tool Adapter', '/integrations/tools'], ['Skill 与 Plugin', '/integrations/skill-plugin'], ['CLI 与维护', '/integrations/cli'], ['远程 HTTPS', '/integrations/remote']] },
  { text: 'API 参考', items: [['完整配置', '/reference/configuration'], ['SDK 方法与结果', '/reference/sdk'], ['公开类型', '/reference/types'], ['错误与恢复', '/reference/errors']] },
  { text: '示例', items: [['运行示例', '/examples/index'], ['多个 Provider', '/examples/multi-provider'], ['VextJS', '/examples/vextjs']] },
  { text: '资源', items: [['安全与授权', '/resources/security'], ['版本与兼容', '/resources/compatibility'], ['故障排查', '/resources/troubleshooting'], ['源码开发与检查', '/resources/development']] },
];
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
    darkMode: false,
    nav: [
      { text: '指南', link: '/getting-started/introduction', activeMatch: '^/(getting-started|guide)/' },
      { text: '模型匹配', link: '/models/match', activeMatch: '^/models/' },
      { text: '宿主接入', link: '/integrations/overview', activeMatch: '^/integrations/' },
      { text: 'API', link: '/reference/configuration', activeMatch: '^/reference/' },
      { text: '示例', link: '/examples/index', activeMatch: '^/examples/' },
    ],
    sidebar: Object.fromEntries(['/'].map(prefix => [prefix, groups.map(g => ({ text: g.text, items: g.items.map(([text, link]) => ({ text: text!, link: link! })) }))])),
    socialLinks: [{ icon: 'github', mode: 'link', content: 'https://github.com/devcodex-labs/capability-graph' }],
    footer: { message: 'Apache-2.0 · Capability Graph v2.0.0' },
    lastUpdated: true,
  },
});

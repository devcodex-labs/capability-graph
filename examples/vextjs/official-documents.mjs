import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './source-provenance.mjs';

// Integration-authored task associations, not upstream capability declarations or executable recipes.
const topic = (capabilityId, name, whenToUse, chapters, nativeIds = []) => ({ capabilityId, name, whenToUse, chapters, nativeIds });
export const documentationTopics = [
  topic('quick-start', '快速开始', '创建 VextJS 项目运行 Hello World', ['guide/introduction.md', 'guide/quick-start.md', 'examples/hello-world.md']),
  topic('project-structure', '项目结构', '发现项目目录 src routes services plugins Models frontend', ['guide/project-structure.md', 'specification/architecture.md'], ['C01', 'C02']),
  topic('routing', '路由', 'HTTP API 路由 请求入口 注册请求处理 defineRoutes method path fullPath', ['guide/routing.md', 'api/route-definition.md', 'specification/http-and-routing.md'], ['C03']),
  topic('validation', '参数校验', '请求响应 schema validation 校验 数据契约', ['guide/validation.md', 'specification/validation-and-contracts.md'], ['C04']),
  topic('services', '服务层', 'Service 服务依赖图 dependency injection', ['guide/services.md', 'specification/architecture.md'], ['C05']),
  topic('middleware', '中间件', 'Middleware 请求响应中间件', ['guide/middleware.md'], ['C06']),
  topic('plugins', '插件', 'Plugin 插件 setup onReady onClose 生命周期 app 扩展', ['guide/plugins.md', 'api/plugin-api.md', 'specification/architecture.md'], ['C07', 'RCP-08']),
  topic('database', '数据库', '原生分页 多数据库 Models MonSQLize CRUD app.db', ['guide/database.md', 'specification/data-access.md', 'examples/crud-api.md'], ['C08', 'K05']),
  topic('configuration', '配置', 'config 配置分层 default bodyParser', ['guide/configuration.md', 'api/config.md'], ['C12']),
  topic('openapi', 'OpenAPI 文档', 'OpenAPI Docs 机器文档', ['guide/openapi.md'], ['C13']),
  topic('testing', '测试', 'Mock 数据场景 测试脚本 createTestApp', ['guide/testing.md', 'api/testing-api.md'], ['C14', 'C15']),
  topic('build', '构建', '构建 typegen vext build 类型生成', ['guide/build.md', 'specification/operations.md'], ['C16']),
  topic('cluster', 'Cluster 多进程', 'Cluster rolling reload 多进程重启 状态检查', ['guide/cluster.md', 'specification/operations.md'], ['C17']),
  topic('application', '应用实例与上下文', 'VextApp VextRequest app 请求上下文 Runtime Hooks', ['api/app.md', 'api/context.md', 'guide/request-context.md', 'guide/hooks.md']),
  topic('cache', '响应缓存', 'cache 响应缓存 ttl CacheHub', ['guide/cache.md'], ['C19', 'K06']),
  topic('rate-limit', '请求限流', 'rateLimit 请求限流 quota', ['guide/rate-limit.md'], ['C20']),
  topic('cookies-session', 'Cookies 与 Sessions', 'cookie session csrf session store cache adapter', ['guide/cookies-session.md', 'specification/security-and-resources.md'], ['C21', 'K06']),
  topic('security', '认证与安全', '认证 权限 CSRF 安全资源 permission-core Auth', ['guide/security.md', 'specification/security-and-resources.md', 'examples/permission-core-auth.md'], ['C21']),
  topic('uploads', '文件上传', '文件上传 multipart body parser', ['guide/uploads.md'], ['C22']),
  topic('jobs', '任务与 Jobs', 'jobs worker scheduler retry 后台异步任务失败后重试', ['guide/jobs.md', 'api/jobs.md', 'specification/jobs.md'], ['C34', 'K07']),
  topic('adapters', 'Adapter 架构', 'Native Hono Fastify Express Koa adapter', ['guide/adapters.md', 'specification/architecture.md']),
  topic('cli', 'CLI 命令', 'vext CLI 命令 init dev start', ['guide/cli.md']),
  topic('deployment', '部署与生产环境', 'production 部署 环境 运维', ['guide/deployment.md', 'specification/operations.md']),
  topic('error-handling', '错误处理', '异常 错误响应 error handling', ['guide/error-handling.md']),
  topic('fetch', '内置 HTTP 客户端', 'app.fetch HTTP fetch 请求 取消 timeout', ['guide/fetch.md', 'api/fetch.md']),
  topic('logger', '日志', 'logger access log 日志', ['guide/logger.md', 'api/access-log.md']),
  topic('preload', '预加载', 'preload 启动预加载', ['guide/preload.md']),
  topic('hot-reload', '热重载', 'hot reload 开发热重载', ['guide/hot-reload.md']),
  topic('i18n', '国际化', 'Locales i18n 国际化 locale 多语言', ['guide/i18n.md', 'frontend/i18n.md'], ['C11']),
  topic('mcp-generation', 'MCP 代码生成与依赖知识', 'MCP 代码生成 依赖知识 宿主操作', ['guide/mcp-generation.md'], ['C33']),
  topic('observability', 'OpenTelemetry 可观测性', 'OpenTelemetry tracing 可观测性', ['examples/opentelemetry.md']),
  topic('nacos-integration', 'Nacos 接入', 'Nacos 配置服务发现', ['examples/nacos-integration.md']),
  topic('frontend.overview', '前端入门与边界', 'frontend 前端 项目结构 路线图 快速开始', ['guide/frontend.md', 'frontend/overview.md', 'frontend/getting-started.md', 'frontend/project-structure.md', 'frontend/boundaries-and-roadmap.md']),
  topic('frontend.rendering', '页面与渲染', '服务端页面 layout document SSR CSR SPA HTML 渲染 不需要客户端 JavaScript', ['frontend/pages-and-rendering.md', 'frontend/routing-and-pages.md', 'frontend/rendering-modes.md', 'frontend/ssr.md', 'frontend/csr-and-spa-fallback.md'], ['C09', 'RCP-03']),
  topic('frontend.layouts', 'Layout 与组件', 'layout 组件 document 错误页', ['frontend/layouts-and-components.md', 'frontend/errors-and-document.md']),
  topic('frontend.hydration', 'Hydration', 'hydrate hydration 验证', ['frontend/hydration.md', 'frontend/hydration-validation.md']),
  topic('frontend.static-assets', '静态资源与 CDN', '静态资源 static assets CDN', ['frontend/static-assets-and-cdn.md'], ['C10']),
  topic('frontend.styles', '样式与资源', 'styles CSS JSCSS', ['frontend/styles-and-assets.md', 'frontend/jscss.md']),
  topic('frontend.data', '数据与 API 契约', 'API Client contracts data flow 数据流', ['frontend/api-client-and-contracts.md', 'frontend/data-and-api.md', 'frontend/data-flow.md']),
  topic('frontend.cache', 'Render Data 与缓存', 'render data cache refresh 页面缓存', ['frontend/render-data-and-cache.md', 'frontend/render-refresh.md']),
  topic('frontend.configuration', '前端配置', 'frontend configuration 前端配置', ['frontend/configuration.md']),
  topic('frontend.build', '前端构建与发布', 'frontend build deploy performance code splitting', ['frontend/build-and-deploy.md', 'frontend/build-deploy-performance.md', 'frontend/code-splitting.md']),
  topic('frontend.development', '前端开发工作流', 'dev workflow fast refresh', ['frontend/dev-workflow.md', 'frontend/fast-refresh.md']),
  topic('frontend.diagnostics', '前端诊断与排错', 'diagnostics leak scan troubleshooting 前端排错', ['frontend/diagnostics-and-leak-scan.md', 'frontend/troubleshooting.md']),
  topic('frontend.seo', 'SEO 与 Sitemap', 'SEO Sitemap Robots', ['frontend/seo-sitemap.md']),
  topic('frontend.performance', '前端性能预算', 'performance budgets 性能预算', ['frontend/performance-budgets.md']),
];

const referenceOnly = {
  'index.mdx': 'Site landing page; reference material rather than an implementation task',
  'benchmark.md': 'Published benchmark description; no performance or execution claim',
  'resources/documentation-data-and-ai.md': 'Documentation and AI resource overview',
  'resources/support-and-services.md': 'Support and services information',
  'specification/index.md': 'Specification navigation; individual specifications are attached to implementation topics',
};
export const knowledgeIdForChapter = (chapter) => chapter.replace(/\.mdx?$/, '').replaceAll('/', '.');
export const capabilityFileFor = (id) => `capabilities/${id.replaceAll('.', '/')}.json`;
const roleFor = (chapter) => chapter.startsWith('specification/') ? 'specification' : chapter.startsWith('api/') ? 'reference' : chapter.startsWith('examples/') ? 'example' : 'guide';

/** Enumerate ALL upstream chapters. New/unclassified chapters require review instead of silently disappearing. */
export async function officialDocumentMappings(sourceRoot, catalog, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Full source commit required');
  const root = await realpath(path.join(sourceRoot, 'website/docs/zh'));
  const chapters = [];
  async function walk(relative = '') {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const chapter = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Official document symlink unsupported: ${chapter}`);
      if (entry.isDirectory()) await walk(chapter);
      else if (entry.isFile() && /\.mdx?$/.test(chapter)) chapters.push(chapter);
    }
  }
  await walk(); chapters.sort();
  for (const topic of documentationTopics) for (const chapter of topic.chapters) {
    if (!chapters.includes(chapter)) throw new Error(`Missing official chapter: ${chapter}`);
  }
  const documents = [];
  for (const chapter of chapters) {
    const capabilityIds = documentationTopics.filter((topic) => topic.chapters.includes(chapter)).map((topic) => topic.capabilityId);
    if (!capabilityIds.length && !referenceOnly[chapter]) throw new Error(`Unclassified official chapter: ${chapter}`);
    const bytes = await readFile(path.join(root, chapter)); const originalPath = `website/docs/zh/${chapter}`;
    documents.push({ chapter, knowledgeId: knowledgeIdForChapter(chapter), originalPath, title: bytes.toString().match(/^#\s+(.+)$/m)?.[1] ?? chapter,
      role: roleFor(chapter), locale: 'zh', sha256: sha256(bytes), bytes: bytes.length, sourceCommit: commit,
      url: `https://raw.githubusercontent.com/devcodex-labs/vextjs/${commit}/${originalPath}`, capabilityIds,
      classification: capabilityIds.length ? 'task-associated' : 'reference-only', referenceReason: referenceOnly[chapter],
      verification: { sourceBytes: 'fingerprinted', frameworkBehavior: 'not-established-by-document-reading' } });
  }
  const mappings = (catalog?.items ?? []).map((item) => ({ nativeId: item.id, role: item.kind,
    capabilityIds: documentationTopics.filter((topic) => topic.nativeIds.includes(item.id)).map((topic) => topic.capabilityId),
    coverage: documentationTopics.some((topic) => topic.nativeIds.includes(item.id)) ? 'integration-authored-topic-association' : 'native-audit-only; no public task mapping' }));
  return { documents, topics: documentationTopics, mappings,
    associationOrigin: 'Integration-authored task associations; upstream Markdown/MDX bytes are unmodified',
    inventoryPolicy: 'Every chapter is task-associated or explicitly reference-only; document coverage does not establish framework behavior' };
}

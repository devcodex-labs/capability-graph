# Capability Graph

Describe the capabilities of a framework, SDK, or project in static JSON. Let applications and AI hosts discover them, read usage guidance, check applicability, and resolve declared dependencies.

**v2.0.0** · Node.js / TypeScript · MCP stdio / Streamable HTTP · Apache-2.0

A Provider is a named source of capability definitions. Its author declares capabilities and relationships; the application or model selects existing IDs; Graph validates access, supplied facts, and dependencies. The caller decides how to use the result. Graph does not execute capabilities, infer project facts, or provide an agent runtime, RAG, or embeddings.

[Documentation (中文)](https://devcodex-labs.github.io/capability-graph/getting-started/introduction.html) · [Examples](https://devcodex-labs.github.io/capability-graph/examples/index.html) · [Issues](https://github.com/devcodex-labs/capability-graph/issues) · [Changelog](CHANGELOG.md)

## Contents

[Choose a path](#choose-a-path) · [Install](#install) · [First graph](#your-first-graph) · [Configuration](#configuration) · [Local documents and URL references](#local-documents-and-url-references) · [Integrations](#integrations) · [Results and errors](#results-and-errors) · [Contributing](#contributing)

## Choose a path

| Your task | Start here | Who selects capabilities? |
| --- | --- | --- |
| Your application already knows the capability IDs | Run the SDK example below | Your application; no model required |
| An existing AI client should discover capabilities | [Codex setup](https://devcodex-labs.github.io/capability-graph/integrations/codex.html) or [MCP](https://devcodex-labs.github.io/capability-graph/integrations/mcp.html) | The host's current model |
| Your application needs natural-language selection | [Model matching](https://devcodex-labs.github.io/capability-graph/models/match.html) with an explicit ModelExecutor | The model configured by your application |

For an existing Agent or MCP Server, use the [tool adapter](https://devcodex-labs.github.io/capability-graph/integrations/tools.html) or [server integration](https://devcodex-labs.github.io/capability-graph/integrations/existing-server.html). Skill, Plugin, and transport options are explained in the [complete integration guide](https://devcodex-labs.github.io/capability-graph/getting-started/introduction.html#完整接入清单).

## Install

Requires **Node.js >=22.12.0 and ESM**. Use `.mjs`, or set `"type":"module"` for JavaScript; compile TypeScript as ESM/NodeNext.

In a new application directory (Bash or PowerShell):

```sh
mkdir graph-demo
cd graph-demo
npm init -y
npm install @devcodex/capability-graph
```

Static queries need no model SDK, account, or API key. Installation does not start a service or register anything in your AI host. Run the local CLI with `npx --no-install capability-graph`; [installation options](https://devcodex-labs.github.io/capability-graph/getting-started/installation.html) include a global CLI install.

## Your first graph

This example describes an HTTP endpoint that requires a request schema. It resolves that declared dependency without running a web framework. Create two files in `graph-demo/`; no knowledge directory is needed.

First, save this as `provider.json`:

<!-- example:examples/minimal/provider.json -->
```json title="provider.json"
{
  "providerId": "acme",
  "name": "Acme HTTP",
  "version": "1.0.0",
  "capabilities": [
    {
      "id": "route",
      "name": "Validated HTTP endpoint",
      "description": "Create an HTTP endpoint with request validation.",
      "whenToUse": "The application needs an HTTP endpoint with validated input.",
      "usage": { "instructions": "Declare the request schema, then register the endpoint." },
      "relations": { "requires": ["schema"] }
    },
    { "id": "schema", "name": "Request schema", "description": "Declare a schema to validate request input." }
  ]
}
```

The Provider requires `providerId`, `name`, `version`, and `capabilities`. Each capability requires `id`, `name`, and `description`; guidance and relationships are optional. Here, `route` explicitly requires `schema`, which has no usage instructions.

Next, save `static.mjs` beside that JSON. It locates the declaration relative to the script, prints the complete result, reports Graph errors on stderr, and closes Graph even after failure.

<!-- example:examples/minimal/static.mjs -->
```js title="static.mjs"
import { CapabilityGraph, GraphError } from '@devcodex/capability-graph';
import { fileURLToPath } from 'node:url';

let graph;
try {
  graph = await CapabilityGraph.open({
    providers: [{ file: fileURLToPath(new URL('./provider.json', import.meta.url)) }]
  });
  const result = await graph.resolve({ ids: ['acme::route'] });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (!(error instanceof GraphError)) throw error;
  console.error(JSON.stringify({ code: error.code, phase: error.phase, nextAction: error.nextAction }));
  process.exitCode = 1;
} finally {
  await graph?.close();
}
```

```sh
node static.mjs
```

| Option / call | Meaning and default |
| --- | --- |
| `providers: [{file: ...}]` | Load this Provider JSON. A source accepts either `file` or an inline `definition`. |
| Omitted `allowedProviders` | Allow all loaded Providers; `[]` allows none. |
| `resolve.ids: ['acme::route']` | Select this root by its full `providerId::capabilityId`. |
| Omitted `relations` | Expand the transitive `requires` dependencies; `[]` keeps only roots. |
| Omitted `context` | Supply no facts. This example declares no conditions, so its nodes are applicable. |
| Omitted `model` | Static methods work without invoking a model. |

The result contains `acme::route` and its dependency `acme::schema`. Their `origin` values explain why each appears. `unresolved: []` and `meta.completeness: 'complete'` mean the requested graph was fully resolved; they do not mean the capabilities were executed.

<details>
<summary>Complete output from node static.mjs</summary>

```json
{
  "selected": [
    "acme::route"
  ],
  "nodes": [
    {
      "capability": {
        "id": "acme::route",
        "providerId": "acme",
        "name": "Validated HTTP endpoint",
        "description": "Create an HTTP endpoint with request validation.",
        "whenToUse": "The application needs an HTTP endpoint with validated input.",
        "usage": {
          "instructions": "Declare the request schema, then register the endpoint."
        },
        "relations": {
          "parents": [],
          "specializes": [],
          "related": [],
          "requires": [
            "acme::schema"
          ]
        },
        "documents": []
      },
      "origin": "selected",
      "applicability": {
        "status": "applicable",
        "missingFacts": [],
        "invalidFacts": [],
        "failedConditions": []
      }
    },
    {
      "capability": {
        "id": "acme::schema",
        "providerId": "acme",
        "name": "Request schema",
        "description": "Declare a schema to validate request input.",
        "relations": {
          "parents": [],
          "specializes": [],
          "related": [],
          "requires": []
        },
        "documents": []
      },
      "origin": "dependency",
      "applicability": {
        "status": "applicable",
        "missingFacts": [],
        "invalidFacts": [],
        "failedConditions": []
      }
    }
  ],
  "edges": [
    {
      "from": "acme::route",
      "type": "requires",
      "to": "acme::schema"
    }
  ],
  "unresolved": [],
  "meta": {
    "revision": "sha256:be714d7dc37a706d72862ee2d485c7c127a9f684d8124796f4fc65e786a5285a",
    "completeness": "complete",
    "warnings": []
  }
}
```

</details>

To display the returned guidance, insert this **result-consumption fragment** after `const result = ...` in the script above. It adds human-readable lines to stdout:

```js
for (const { capability, origin, applicability } of result.nodes) {
  console.log(`${capability.id} (${origin}, ${applicability.status})`);
  console.log(capability.usage?.instructions ?? 'No usage instructions provided');
}
```

Use optional chaining because usage instructions are optional. The [quick start](https://devcodex-labs.github.io/capability-graph/getting-started/quick-start.html) also includes a complete inline version; the [result guide](https://devcodex-labs.github.io/capability-graph/guide/results.html) explains the remaining fields and how to act on them.

## Configuration

The SDK takes options in `CapabilityGraph.open(options)`. The CLI reads a separate JSON file. For the same example, save `graph.config.json`:

```json
{
  "schemaVersion": 1,
  "providers": [{ "file": "./provider.json" }],
  "allowedProviders": ["acme"]
}
```

```sh
npx --no-install capability-graph validate --file provider.json
npx --no-install capability-graph doctor --config graph.config.json
```

`validate` checks the declaration; `doctor` checks the graph configuration and tool conditions without calling a model. CLI file paths are relative to the config file. SDK relative paths use the working directory at `open`; the first example avoids that difference with `import.meta.url`.

| Setting | When to use it |
| --- | --- |
| `providers[].file` | Load a JSON file; its directory is the root for local documents. |
| `providers[].definition` | Load an in-memory Provider value. |
| `providers[].documentRoot` | Give an inline Provider a trusted local document root. File-based Providers already have one. |
| `allowedProviders` | Set the fixed access boundary. Queries can narrow it, never expand it. |
| `model` | Supply an explicit executor for `match()`; omit it for static queries. |
| `limits` | Set byte budgets; see [defaults and validation](https://devcodex-labs.github.io/capability-graph/reference/configuration.html). |

For multiple Providers, add one source per Provider and use full IDs for cross-source relationships, such as `shared::schema`. See the [runnable dependency example](https://devcodex-labs.github.io/capability-graph/guide/relations.html#跨-provider-的最小例子).

## Local documents and URL references

Associate a capability with a local guide or an HTTPS reference using `capabilities[].documents[].source`. Capability definitions remain in the Provider's `capabilities` array. The following is a **capability fragment**, to be placed inside that array:

```json
{
  "id": "route",
  "name": "Validated HTTP endpoint",
  "description": "Create an HTTP endpoint with request validation.",
  "documents": [
    { "id": "guide", "source": { "type": "file", "path": "knowledge/route.md" } },
    { "id": "upstream", "source": { "type": "url", "url": "https://example.com/guide" } }
  ]
}
```

For a file-based Provider, create `knowledge/route.md` beside `provider.json`. The relative path stays inside that Provider's directory. For an inline Provider, set `documentRoot` to the trusted directory containing `knowledge/`.

After opening this Provider, use these **fragments inside its existing Graph lifecycle**:

```js
const doc = await graph.readDocument({ capabilityId: 'acme::route', documentId: 'guide' });
console.log(doc.text); // Local UTF-8 text; doc also includes byteLength and contentHash.

const details = await graph.getCapabilities({ ids: ['acme::route'] });
const upstream = details.items[0].capability.documents.find(doc => doc.id === 'upstream');
console.log(upstream.source.url); // https://example.com/guide
```

`readDocument` accepts declared capability/document IDs rather than arbitrary paths. URL documents are **references only**: Graph does not fetch them; calling `readDocument` on `upstream` throws `CG_DOCUMENT_REFERENCE_ONLY`. See the [complete local-file and URL walkthrough](https://devcodex-labs.github.io/capability-graph/guide/documents.html#本地文件与-url-引用的完整示例) for all files, parameters, and error handling.

## Integrations

| Goal | Guide and prerequisites |
| --- | --- |
| Use the current Codex model | [Codex setup](https://devcodex-labs.github.io/capability-graph/integrations/codex.html): explicitly register stdio MCP and the official discovery Skill; no second model or API key. |
| Connect another MCP client | [stdio and HTTP](https://devcodex-labs.github.io/capability-graph/integrations/mcp.html): client-owned stdio process or a separately running HTTP service. |
| Use a private remote service | [HTTPS and Bearer client](https://devcodex-labs.github.io/capability-graph/integrations/remote.html): reachable TLS endpoint, compatible protocol, and authentication accepted by the host. |
| Distribute a Skill / Plugin | [Plugin installation](https://devcodex-labs.github.io/capability-graph/integrations/skill-plugin.html): an explicit host installation and a running HTTP service for the Plugin. |
| Match using OpenAI | [OpenAI](https://devcodex-labs.github.io/capability-graph/models/openai.html): optional `openai@7.39.0`, API credentials, and Responses with strict Structured Outputs. |
| Match using a separate Codex process | [Independent Codex CLI](https://devcodex-labs.github.io/capability-graph/models/codex.html): Linux, bubblewrap, pinned native CLI 0.163.0, trusted runtime and dedicated login directory. |
| Reuse an existing model | [Custom executor](https://devcodex-labs.github.io/capability-graph/models/custom.html): adapt the application's model call to the public ModelExecutor contract. |

The independent Codex adapter rejects native Windows. WSL and Linux containers must satisfy the CLI, bubblewrap, and mount-permission requirements in their actual environment; a Linux platform value alone does not establish support. This restriction does not apply to static SDK queries or Codex using its current model over MCP.

MCP stdio supports **2026-07-28 and 2025-06-18**; HTTP supports **2026-07-28 only**. There are five static tools by default. The sixth, `capability_graph_match`, requires an explicitly configured executor and `enableMatch: true`. See [compatibility](https://devcodex-labs.github.io/capability-graph/resources/compatibility.html).

## Results and errors

| Check | Meaning / next action |
| --- | --- |
| `match.status` | `matched`, `no_match`, `ambiguous`, or `needs_context`; clarify the task or supply facts when needed. |
| `node.applicability.status` | `applicable`, `inapplicable`, or `unknown`; inspect missing/invalid facts and failed conditions. |
| `meta.completeness` | `complete` or `partial`; inspect `unresolved` before relying on dependencies. |
| `meta.revision` | Identifies the authorized static view. It does not hash document bodies; use `contentHash` for a document read. |
| `GraphError` | Inspect `code`, `phase`, and optional `nextAction`. An access, authentication, or timeout failure is an error, not `no_match`. |

A model match can still contain unknown applicability or unresolved dependencies. For recovery steps, use [errors](https://devcodex-labs.github.io/capability-graph/reference/errors.html) and [troubleshooting](https://devcodex-labs.github.io/capability-graph/resources/troubleshooting.html). Complete method signatures, types, and defaults are in the [SDK](https://devcodex-labs.github.io/capability-graph/reference/sdk.html), [types](https://devcodex-labs.github.io/capability-graph/reference/types.html), and [configuration](https://devcodex-labs.github.io/capability-graph/reference/configuration.html) references.

## Run the packaged examples

Copy the package's examples into a directory that does not already exist. In Bash:

```sh
cp -R node_modules/@devcodex/capability-graph/examples ./examples
```

In PowerShell:

```powershell
Copy-Item -LiteralPath node_modules/@devcodex/capability-graph/examples -Destination ./examples -Recurse
```

Then run either shell's Node commands from the project root:

```sh
node examples/minimal/static.mjs
node examples/multi-provider/main.mjs
node examples/vextjs/resolve.mjs
```

These three commands use static declarations and need no model. The [example index](https://devcodex-labs.github.io/capability-graph/examples/index.html) lists expected results and optional dependencies, including the separate VextJS framework check.

## Contributing

Bug reports and focused pull requests are welcome on [GitHub](https://github.com/devcodex-labs/capability-graph). Include the package and Node versions, a minimal declaration/configuration, the command you ran, and the observed error when reporting a problem.

For source setup, checks, and documentation development, see the [contributor guide](https://devcodex-labs.github.io/capability-graph/resources/development.html). Documentation source lives in `website/content`; the website and its build output are separate from the SDK package.

## License

[Apache-2.0](LICENSE).

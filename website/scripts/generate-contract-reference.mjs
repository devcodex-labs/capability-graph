import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { generatedRoot, repositoryRoot } from './lib/paths.mjs';

const declarationPath = path.join(repositoryRoot, 'dist', 'index.d.ts');

function resolveExport(symbol, checker) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function symbolKind(symbol) {
  const flags = symbol.flags;
  if (flags & ts.SymbolFlags.Class) return 'class';
  if (flags & ts.SymbolFlags.Interface) return 'interface';
  if (flags & ts.SymbolFlags.TypeAlias) return 'type';
  if (flags & ts.SymbolFlags.Function) return 'function';
  if (flags & ts.SymbolFlags.Variable) return 'value';
  return 'symbol';
}

function literalUnion(symbol, checker) {
  const declaration = symbol.declarations?.find(ts.isTypeAliasDeclaration);
  if (!declaration) return undefined;
  const type = checker.getTypeAtLocation(declaration);
  if (!type.isUnion()) return undefined;
  const values = type.types.flatMap((part) => part.isStringLiteral() ? [part.value] : []);
  return values.length === type.types.length ? values : undefined;
}

await readFile(declarationPath, 'utf8');
const program = ts.createProgram([declarationPath], {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  skipLibCheck: true
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => repositoryRoot,
    getNewLine: () => '\n'
  }));
}

const source = program.getSourceFile(declarationPath);
const checker = program.getTypeChecker();
const moduleSymbol = source && checker.getSymbolAtLocation(source);
if (!source || !moduleSymbol) throw new Error('cannot resolve dist/index.d.ts module symbol');

const symbols = checker.getExportsOfModule(moduleSymbol)
  .map((symbol) => {
    const target = resolveExport(symbol, checker);
    return {
      name: symbol.getName(),
      kind: symbolKind(target),
      literals: literalUnion(target, checker)
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

const contracts = {
  schemaVersion: 'CapabilityGraphPublicContractsV1',
  package: '@devcodex-labs/capability-graph',
  entry: 'dist/index.d.ts',
  symbols
};
await writeFile(
  path.join(generatedRoot, 'contracts', 'public-api.json'),
  `${JSON.stringify(contracts, null, 2)}\n`,
  'utf8'
);

const unionContracts = Object.fromEntries(
  symbols.filter((symbol) => symbol.literals).map((symbol) => [symbol.name, symbol.literals])
);
await writeFile(
  path.join(generatedRoot, 'contracts', 'literal-unions.json'),
  `${JSON.stringify(unionContracts, null, 2)}\n`,
  'utf8'
);

const table = [
  '## Generated public symbols',
  '',
  '| Symbol | Kind |',
  '|---|---|',
  ...symbols.map((symbol) => `| \`${symbol.name}\` | ${symbol.kind} |`),
  ''
].join('\n');
await writeFile(path.join(generatedRoot, 'snippets', 'public-api.mdx'), table, 'utf8');

const errorRows = (unionContracts.ErrorCode ?? []).map((code) => `| \`${code}\` |`).join('\n');
const actionRows = (unionContracts.NextAction ?? []).map((action) => `| \`${action}\` |`).join('\n');
await writeFile(
  path.join(generatedRoot, 'snippets', 'errors.mdx'),
  `## Complete ErrorCode union\n\n| ErrorCode |\n|---|\n${errorRows}\n\n## Complete NextAction union\n\n| NextAction |\n|---|\n${actionRows}\n`,
  'utf8'
);

console.log(`generated ${symbols.length} public symbols from dist/index.d.ts`);

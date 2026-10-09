import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { generatedRoot, repositoryRoot, websiteRoot } from '../../scripts/lib/website-paths.mjs';

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

const printer = ts.createPrinter({ removeComments: true });
const typeFlags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
const publicType = (value) => value.replace(/import\("[^"]+"\)\./g, '');
function contractShape(symbol, checker) {
  const declaration = symbol.declarations?.[0];
  if (!declaration) throw new Error(`missing declaration for ${symbol.name}`);
  const name = symbol.name;
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const fields = (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.TypeAlias))
    && (type.flags & ts.TypeFlags.Object) ? checker.getPropertiesOfType(type).flatMap((field) => {
      const member = field.valueDeclaration ?? field.declarations?.[0];
      if (!member || ts.getCombinedModifierFlags(member) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return [];
      return [{ name: field.name, optional: Boolean(field.flags & ts.SymbolFlags.Optional),
        type: publicType(checker.typeToString(checker.getTypeOfSymbolAtLocation(field, member), member, typeFlags)) }];
    }) : [];
  let signature;
  if (ts.isClassDeclaration(declaration)) {
    const members = declaration.members.flatMap((member) => {
      if ((!ts.isMethodDeclaration(member) && !ts.isConstructorDeclaration(member)) || ts.getCombinedModifierFlags(member) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return [];
      if (ts.isConstructorDeclaration(member) && name === 'BoundProviderGraph') return [];
      if (ts.isConstructorDeclaration(member)) return [`  ${publicType(printer.printNode(ts.EmitHint.Unspecified, member, member.getSourceFile()))}`];
      const call = checker.getSignatureFromDeclaration(member);
      const prefix = ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static ? 'static ' : '';
      return [`  ${prefix}${member.name.getText()}${publicType(checker.signatureToString(call, member, typeFlags))};`];
    });
    signature = `class ${name} {\n${members.join('\n')}\n}`;
  } else if (ts.isInterfaceDeclaration(declaration)) {
    signature = `interface ${name}${declaration.typeParameters?.length ? `<${declaration.typeParameters.map((part) => part.getText()).join(', ')}>` : ''} {\n${fields.map((field) =>
      `  readonly ${field.name}${field.optional ? '?' : ''}: ${field.type};`).join('\n')}\n}`;
  } else if (ts.isTypeAliasDeclaration(declaration) || ts.isFunctionDeclaration(declaration)) {
    signature = publicType(printer.printNode(ts.EmitHint.Unspecified, declaration, declaration.getSourceFile()));
  } else {
    signature = `const ${name}: ${publicType(checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, declaration), declaration, typeFlags))};`;
  }
  return { fields, signature };
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
      literals: literalUnion(target, checker),
      ...contractShape(target, checker)
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

const contracts = {
  schemaVersion: 'CapabilityGraphPublicContractsV1',
  package: '@devcodex/capability-graph',
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

const symbolKindLabels = {
  class: '类',
  function: '函数',
  interface: '接口',
  type: '类型',
  value: '值'
};
const table = [
  '## 生成的公开符号',
  '',
  '| 符号 | 类型 |',
  '|---|---|',
  ...symbols.map((symbol) => `| \`${symbol.name}\` | ${symbolKindLabels[symbol.kind] ?? symbol.kind} |`),
  ''
].join('\n');
await writeFile(path.join(generatedRoot, 'snippets', 'public-api.mdx'), table, 'utf8');

const coverage = JSON.parse(await readFile(path.join(websiteRoot, 'data/reference-coverage.json'), 'utf8'));
for (const page of new Set(coverage.entries.map((entry) => entry.page))) {
  const entries = coverage.entries.filter((entry) => entry.page === page);
  const lines = ['## 完整签名与字段', '',
    '以下由公开声明生成。接口继承字段已展开；`?` 表示可省略，**不表示可传 null**。类型不能表达的默认值、值域、预算与失败语义以本页正文为准。类仅列公开方法；绑定对象必须由 forProvider 获取。', ''];
  for (const entry of entries) {
    const symbol = symbols.find((item) => item.name === entry.symbol);
    if (!symbol) throw new Error(`unknown reference symbol: ${entry.symbol}`);
    lines.push(`### ${symbol.name} 合同`, '', '```ts', symbol.signature, '```', '');
    if (symbol.fields.length) lines.push('| 字段/方法 | 类型 | 必填 |', '|---|---|---|',
      ...symbol.fields.map((field) => `| \`${field.name}\` | \`${field.type.replaceAll('|', '\\|')}\` | ${field.optional ? '否' : '是'} |`), '');
  }
  await writeFile(path.join(generatedRoot, 'snippets', `contracts-${path.basename(page)}`), lines.join('\n'), 'utf8');
}

const errorGuidance = JSON.parse(await readFile(path.join(websiteRoot, 'data', 'error-guidance.json'), 'utf8'));
const errorCodes = unionContracts.ErrorCode ?? [];
const nextActions = new Set(unionContracts.NextAction ?? []);
const guidanceCodes = errorGuidance.map(({ code }) => code);
const missingGuidance = errorCodes.filter((code) => !guidanceCodes.includes(code));
const staleGuidance = guidanceCodes.filter((code) => !errorCodes.includes(code));
if (new Set(guidanceCodes).size !== guidanceCodes.length || missingGuidance.length || staleGuidance.length) {
  throw new Error(`error guidance mismatch; missing=${missingGuidance.join(',')} stale=${staleGuidance.join(',')}`);
}
for (const entry of errorGuidance) {
  if (!entry.meaning || !entry.trigger || !entry.handling || !nextActions.has(entry.action)) {
    throw new Error(`invalid error guidance for ${entry.code}`);
  }
}

const errorRows = errorGuidance.map(({ code, meaning, trigger, action, handling }) =>
  `| \`${code}\` | ${meaning} | ${trigger} | \`${action}\` | ${handling} |`
).join('\n');
const actionRows = (unionContracts.NextAction ?? []).map((action) => `| \`${action}\` |`).join('\n');
await writeFile(
  path.join(generatedRoot, 'snippets', 'errors.mdx'),
  `## 完整错误语义\n\n下表覆盖公开 \`ErrorCode\` 全集。典型动作帮助调用方选路，具体处理始终以错误实例的 \`nextAction\` 为准。\n\n| ErrorCode | 含义 | 常见触发 | 典型 NextAction | 调用方处理 |\n|---|---|---|---|---|\n${errorRows}\n\n## 完整 NextAction 联合类型\n\n| NextAction |\n|---|\n${actionRows}\n`,
  'utf8'
);

console.log(`generated ${symbols.length} public symbols from dist/index.d.ts`);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { generatedRoot, repositoryRoot } from './paths.mjs';

const printer = ts.createPrinter({ removeComments: true });
const typeFlags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
const publicType = (value) => value.replace(/import\("[^"]+"\)\./g, '');

// Compare parsed declarations, not text produced by the JSON/MDX generator.
// Expand inherited interface fields, omit non-public class implementation, and
// normalize imports/literal visitation order without erasing signature details.
function canonicalSignature(text) {
  const source = ts.createSourceFile('contract.d.ts', text, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0, 'invalid documentation signature');
  const transformed = ts.transform(source, [(context) => {
    const visit = (node) => {
      if (node.kind === ts.SyntaxKind.ExportKeyword || node.kind === ts.SyntaxKind.DeclareKeyword) return undefined;
      const result = ts.visitEachChild(node, visit, context);
      if (ts.isImportTypeNode(result) && result.qualifier) return result.isTypeOf
        ? ts.factory.createTypeQueryNode(result.qualifier, result.typeArguments)
        : ts.factory.createTypeReferenceNode(result.qualifier, result.typeArguments);
      if (ts.isUnionTypeNode(result)) return ts.factory.updateUnionTypeNode(result, [...result.types].sort((left, right) =>
        printer.printNode(ts.EmitHint.Unspecified, left, source).localeCompare(printer.printNode(ts.EmitHint.Unspecified, right, source))));
      return result;
    };
    return (root) => ts.visitNode(root, visit);
  }]);
  try { return printer.printFile(transformed.transformed[0]); }
  finally { transformed.dispose(); }
}

function declaredSignature(symbol, checker, fields) {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  assert(declaration, `${symbol.name}: missing declaration`);
  const print = (node) => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
  if (ts.isClassDeclaration(declaration)) {
    const members = declaration.members.flatMap((member) => {
      if (ts.getCombinedModifierFlags(member) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return [];
      // A bound graph is obtained through forProvider; its constructor is not a
      // documentation entrypoint. Public class methods include the static side.
      if (ts.isConstructorDeclaration(member)) return symbol.name === 'BoundProviderGraph' ? [] : [print(member)];
      if (!ts.isMethodDeclaration(member)) return [];
      const signature = checker.getSignatureFromDeclaration(member);
      assert(signature, `${symbol.name}: method has no signature`);
      return [`${ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static ? 'static ' : ''}${member.name.getText()}${checker.signatureToString(signature, member, typeFlags)};`];
    });
    return `class ${symbol.name} {\n${members.join('\n')}\n}`;
  }
  if (ts.isInterfaceDeclaration(declaration)) {
    const parameters = declaration.typeParameters?.length ? `<${declaration.typeParameters.map(print).join(', ')}>` : '';
    return `interface ${symbol.name}${parameters} {\n${fields.map((field) =>
      `readonly ${field.name}${field.optional ? '?' : ''}: ${field.type};`).join('\n')}\n}`;
  }
  if (ts.isFunctionDeclaration(declaration)) return symbol.declarations.filter(ts.isFunctionDeclaration).map(print).join('\n');
  if (ts.isTypeAliasDeclaration(declaration)) return print(declaration);
  assert(symbol.flags & ts.SymbolFlags.Variable, `${symbol.name}: unsupported public declaration`);
  return `const ${symbol.name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, declaration), declaration, typeFlags)};`;
}

/** Independently compare emitted fields and rendered signatures with the public declaration graph. */
export async function verifyGeneratedContracts(contracts, coverage, docsRoot, readSnippet = readFile) {
  const entry = path.join(repositoryRoot, 'dist/index.d.ts');
  const program = ts.createProgram([entry], { module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(program.getSourceFile(entry));
  const exports = new Map(checker.getExportsOfModule(module).map((symbol) => [symbol.name,
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol]));
  let fieldCount = 0;
  for (const item of contracts.symbols) {
    const symbol = exports.get(item.name);
    assert(symbol, `no declaration for ${item.name}`);
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    const fields = (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.TypeAlias))
      && (type.flags & ts.TypeFlags.Object) ? checker.getPropertiesOfType(type).flatMap((field) => {
        const node = field.valueDeclaration ?? field.declarations?.[0];
        if (!node || ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return [];
        return [{ name: field.name, optional: Boolean(field.flags & ts.SymbolFlags.Optional),
          type: checker.typeToString(checker.getTypeOfSymbolAtLocation(field, node), node,
            ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope).replace(/import\("[^"]+"\)\./g, '') }];
      }) : [];
    // TypeScript interns unions in visitation order; literal order is not a contract change.
    const normalize = (items) => items.map((field) => ({ ...field, type: field.type.replace(
      /"[^"]+"(?: \| "[^"]+")+/g, (union) => union.split(' | ').sort().join(' | ')) }));
    assert.deepEqual(normalize(item.fields), normalize(fields), `${item.name}: fields, types or optionality drifted`);
    assert.equal(canonicalSignature(item.signature), canonicalSignature(publicType(declaredSignature(symbol, checker, fields))),
      `${item.name}: signature drifted from public declaration`);
    fieldCount += fields.length;
    const page = coverage.entries.find((entry) => entry.symbol === item.name)?.page;
    assert(page, `${item.name}: missing reference route`);
    const snippetName = `contracts-${path.basename(page)}`;
    const authored = await readFile(path.join(docsRoot, page), 'utf8');
    assert(authored.includes(`generated/snippets/${snippetName}`) && authored.includes('<Contracts />'), `${page}: generated contract is not rendered`);
    const rendered = await readSnippet(path.join(generatedRoot, 'snippets', snippetName), 'utf8');
    const block = rendered.split(`### ${item.name} 合同\n`)[1]?.split('\n### ')[0];
    assert(block?.includes('```ts\n' + item.signature + '\n```'), `${item.name}: missing or altered full signature`);
    for (const field of item.fields) {
      const row = `| \`${field.name}\` | \`${field.type.replaceAll('|', '\\|')}\` | ${field.optional ? '否' : '是'} |`;
      assert(block.includes(row), `${item.name}.${field.name}: missing or altered rendered field`);
    }
    if (item.literals) for (const literal of item.literals) assert(block.includes(`"${literal}"`), `${item.name}: missing enum ${literal}`);
  }
  // Compile the emitted declarations as one namespace; snippets are reference
  // shapes, not standalone programs. Reader-only sourceContext is not exported.
  const proofName = path.join(repositoryRoot, 'documentation-contract-proof.d.ts');
  const proof = 'declare namespace Documentation {\ninterface ProviderSourceContext { readonly providerId: string; readonly authorityKind: "file" | "database"; readonly sourceRevision: string; readonly knowledgeRootDir?: string; }\n'
    + contracts.symbols.map((item) => item.signature.replace(/\bdeclare (?=(?:class|function|const)\b)/g, '')).join('\n') + '\n}';
  const host = ts.createCompilerHost({ target: ts.ScriptTarget.ES2022, types: [], skipLibCheck: false });
  const originalSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, language, ...args) => file === proofName
    ? ts.createSourceFile(proofName, proof, language, true) : originalSource(file, language, ...args);
  const proofProgram = ts.createProgram([proofName], { target: ts.ScriptTarget.ES2022, types: [], skipLibCheck: false, noEmit: true }, host);
  const diagnostics = ts.getPreEmitDiagnostics(proofProgram);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => repositoryRoot, getCanonicalFileName: (file) => file, getNewLine: () => '\n'
  }));
  console.log(`generated contract check passed: ${contracts.symbols.length} signatures, ${fieldCount} fields/methods and all literal enums rendered`);
}

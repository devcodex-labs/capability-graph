// Package-internal metadata; no mutable Graph state is exported from public entries.
const executors = new WeakSet<object>();
const explicitScopes = new WeakSet<object>();
export function markExecutor(graph: object): void { executors.add(graph); }
export function hasExecutor(graph: object): boolean { return executors.has(graph); }
export function markExplicitScope(graph: object): void { explicitScopes.add(graph); }
export function hasExplicitScope(graph: object): boolean { return explicitScopes.has(graph); }

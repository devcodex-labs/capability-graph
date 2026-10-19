import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fail, GraphError } from './errors.js';
import type { Snapshot } from './snapshot.js';
import type { DocumentReadResult } from './types.js';

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
/** Roots/ancestors must be trusted against hostile concurrent directory replacement. */
export async function readDocument(snapshot: Snapshot, capabilityId: string, documentId: string, maximum: number): Promise<DocumentReadResult> {
  const capability = snapshot.capabilities.get(capabilityId)!;
  const reference = capability.documents.find(item => item.id === documentId);
  if (!reference) fail('CG_DOCUMENT_NOT_FOUND', 'document', 'Document is not declared on this capability', 'fix_input');
  if (reference.source.type === 'url') fail('CG_DOCUMENT_REFERENCE_ONLY', 'document', 'HTTPS documents are references only', 'check_config');
  const provider = snapshot.providers.get(capability.providerId)!;
  if (!provider.documentRoot) fail('CG_DOCUMENT_ROOT_REQUIRED', 'document', 'Inline file documents require documentRoot', 'check_config');
  try {
    const root = provider.documentRootReal ?? await realpath(provider.documentRoot);
    const target = await realpath(path.join(root, ...reference.source.path.split(/[\\/]/)));
    if (!inside(root, target)) fail('CG_DOCUMENT_ACCESS_DENIED', 'document', 'Document escapes its trusted root', 'contact_admin');
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()) fail('CG_DOCUMENT_UNREADABLE', 'document', 'Document must be a regular file', 'fix_input');
      if (before.size > BigInt(maximum)) fail('CG_DOCUMENT_TOO_LARGE', 'document', 'Document exceeds maxDocumentBytes', 'narrow_scope');
      const chunks: Buffer[] = []; let total = 0;
      for (;;) {
        const buffer = Buffer.alloc(Math.min(65536, maximum - total + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > maximum) fail('CG_DOCUMENT_TOO_LARGE', 'document', 'Document exceeds maxDocumentBytes', 'narrow_scope');
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const after = await handle.stat({ bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) fail('CG_DOCUMENT_UNREADABLE', 'document', 'Document changed during reading', 'retry');
      const raw = Buffer.concat(chunks, total);
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
      catch { fail('CG_DOCUMENT_UNREADABLE', 'document', 'Document is not valid UTF-8', 'fix_input'); }
      return { capabilityId, documentId, source: { type: 'file', path: reference.source.path }, text, byteLength: raw.length, contentHash: 'sha256:' + createHash('sha256').update(raw).digest('hex'), meta: { revision: snapshot.revision, completeness: 'complete', warnings: [] } };
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof GraphError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') fail('CG_DOCUMENT_NOT_FOUND', 'document', 'Document file or root was not found', 'check_config');
    if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') fail('CG_DOCUMENT_ACCESS_DENIED', 'document', 'Document cannot be accessed safely', 'contact_admin');
    fail('CG_DOCUMENT_UNREADABLE', 'document', 'Document could not be read safely', 'retry');
  }
}

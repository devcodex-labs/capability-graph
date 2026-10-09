import { lstatSync, openSync, fstatSync, closeSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Read-only diagnosis for the fixed framework's lstat/fstat consistency guard.
const root = realpathSync(process.argv[2]); const files = [];
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Unexpected source link');
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file); else if (entry.isFile()) files.push(file);
  }
}
visit(path.join(root, 'src'));
const fields = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']; const mismatches = [];
for (const file of files.sort()) {
  const hash = () => createHash('sha256').update(readFileSync(file)).digest('hex');
  const firstHash = hash(); const before = lstatSync(file, { bigint: true }); const fd = openSync(file, 'r');
  try {
    const opened = fstatSync(fd, { bigint: true }); const after = lstatSync(file, { bigint: true });
    const differentFields = fields.filter((field) => before[field] !== opened[field]);
    if (differentFields.length) mismatches.push({ file: path.relative(root, file), differentFields,
      before: Object.fromEntries(fields.map((field) => [field, String(before[field])])),
      opened: Object.fromEntries(fields.map((field) => [field, String(opened[field])])),
      pathStatStable: fields.every((field) => before[field] === after[field]), contentStable: firstHash === hash() });
  } finally { closeSync(fd); }
  if (mismatches.length >= 3) break;
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, inspectedFiles: files.length, mismatches,
  note: 'Diagnostic only. No source or guard was changed and no failed assertion is bypassed.' }, null, 2));

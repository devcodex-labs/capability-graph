import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist-test/test/", import.meta.url));

// Node 20.19 and 22.12 disagree on directory arguments; pass explicit files.
async function testFiles(directory, suffix = '.test.js') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await testFiles(target, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(target);
  }
  return files.sort();
}

const compiled = await testFiles(root);
if (compiled.length === 0) throw new Error("No compiled *.test.js files found");
const files = [...compiled,
  ...await testFiles(fileURLToPath(new URL('../test/validation/', import.meta.url)), '.test.mjs')];
console.log(`Test discovery: ${files.length} files on ${process.version}`);
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

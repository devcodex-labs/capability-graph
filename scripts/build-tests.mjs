import { spawnSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanOutput } from "./clean-output.mjs";

const repository = await realpath(fileURLToPath(new URL("../", import.meta.url)));
// TypeScript overwrites present modules but does not remove outputs whose sources were deleted.
await cleanOutput(repository, "dist-test");
const result = spawnSync(process.execPath, [path.join(repository, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.test.json"], {
  cwd: repository, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

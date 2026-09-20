import { spawnSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanOutput } from "../../../scripts/clean-output.mjs";

const packageRoot = await realpath(fileURLToPath(new URL("../", import.meta.url)));
await cleanOutput(packageRoot, "dist");
const result = spawnSync(process.execPath, [path.join(packageRoot, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], {
  cwd: packageRoot, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

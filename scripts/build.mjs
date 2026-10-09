import { spawnSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanOutput } from "./clean-output.mjs";
import { writeBuildState } from "./lib/build-state.mjs";

const repository = await realpath(fileURLToPath(new URL("../", import.meta.url)));
await cleanOutput(repository, "dist");
const result = spawnSync(process.execPath, [path.join(repository, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], {
  cwd: repository, stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status === 0) await writeBuildState(repository);
process.exitCode = result.status ?? 1;

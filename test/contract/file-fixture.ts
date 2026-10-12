import { after } from "node:test";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UnvalidatedCapabilityRecord, UnvalidatedProviderRecord } from "../../src/store/types.js";
import { createTestDirectory, removeTestDirectory } from "./temporary-directory.js";

const directory = await createTestDirectory("file-fixtures-");
after(() => removeTestDirectory(directory));
let sequence = 0;
export const record = (id: string, fields: Partial<UnvalidatedCapabilityRecord> = {}): UnvalidatedCapabilityRecord =>
  ({ capabilityId: id, name: id, description: "Description", whenToUse: "When needed", ...fields });

/** Real JSON files loaded by the production file authority; no backend query double. */
export class FileFixture {
  provider: UnvalidatedProviderRecord = { providerId: "seed", name: "Seed", version: "1" };
  knowledgeRootDir?: string;
  private readonly directory = path.join(directory, String(++sequence));
  constructor(public records: UnvalidatedCapabilityRecord[]) {}
  get rootDir(): string { return path.resolve(this.knowledgeRootDir ?? this.directory); }
  sync(): void {
    mkdirSync(this.rootDir, { recursive: true });
    for (const name of readdirSync(this.rootDir)) if (name.endsWith(".capability.json")) unlinkSync(path.join(this.rootDir, name));
    writeFileSync(path.join(this.rootDir, "provider.json"), JSON.stringify(this.provider));
    for (const [index, value] of this.records.entries()) writeFileSync(path.join(this.rootDir, `${index}.capability.json`), JSON.stringify(value));
  }
  get authority() {
    this.sync();
    return { kind: "file" as const, rootDir: this.rootDir, definitionLayout: "legacy" as const };
  }
}

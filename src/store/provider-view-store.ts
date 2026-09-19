import { createHash } from "node:crypto";
import { CapabilityGraphError } from "../errors.js";
import type { ValidatedProviderView } from "./types.js";

/** A frozen slot carries the selected source context; queries never consult live configuration. */
export class FrozenGraph {
  constructor(private readonly views: ReadonlyMap<string, ValidatedProviderView>) {}
  getProvider(id: string) { return this.views.get(id)?.provider; }
  getView(id: string) { return this.views.get(id); }
  staticRevision(id: string) { return this.views.get(id)?.staticRevision; }
  listProviderIds() { return [...this.views.keys()].sort(); }
  compositeStaticRevision(ids = this.listProviderIds()): string {
    return `s:${createHash("sha256").update([...ids].sort().map((id) => `${id}:${this.staticRevision(id) ?? ""}`).join("|")).digest("hex").slice(0, 16)}`;
  }
}

interface Entry { view: ValidatedProviderView; references: number }
export interface PinnedStore {
  readonly current: FrozenGraph;
  readonly previous?: FrozenGraph;
  readonly refreshFailed: boolean;
  readonly failedProviders: ReadonlySet<string>;
  release(): Promise<void>;
}

/** Slots and active queries own separate references, including during reload and close. */
export class ProviderViewStore {
  private current = new Map<string, Entry>();
  private previous = new Map<string, Entry>();
  private failures = new Set<string>();
  private closed = false;
  private closing?: Promise<void>;
  private cleanupFailures = 0;
  /** Retirement diagnostics never replace the result of the query releasing its last pin. */
  private async release(entry: Entry): Promise<void> {
    if (--entry.references !== 0) return;
    try { await entry.view.close(); }
    catch { this.cleanupFailures = Math.min(Number.MAX_SAFE_INTEGER, this.cleanupFailures + 1); }
  }

  /** Transfer the current slot reference to previous before retiring the older slot; query references are separate. */
  async replaceProvider(view: ValidatedProviderView): Promise<void> {
    if (this.closed) { await this.release({ view, references: 1 }); throw new CapabilityGraphError("CG_NO_ACTIVE_VIEW", { nextAction: "refresh" }); }
    const id = view.provider.providerId;
    const expired = this.previous.get(id);
    const current = this.current.get(id);
    if (current) this.previous.set(id, current);
    this.current.set(id, { view, references: 1 });
    this.failures.delete(id);
    if (expired) await this.release(expired);
  }

  markRefreshFailed(id: string): void { this.failures.add(id); }

  /** Copy both slot maps synchronously and retain their handles; release is idempotent for this pin. */
  pin(): PinnedStore {
    if (this.closed) throw new CapabilityGraphError("CG_NO_ACTIVE_VIEW", { nextAction: "refresh" });
    const entries = [...this.current.values(), ...this.previous.values()];
    for (const entry of entries) entry.references++;
    const copy = (source: Map<string, Entry>) => new FrozenGraph(new Map([...source].map(([id, entry]) => [id, entry.view])));
    let released = false;
    return { current: copy(this.current), ...(this.previous.size ? { previous: copy(this.previous) } : {}),
      refreshFailed: this.failures.size > 0, failedProviders: new Set(this.failures),
      release: async () => {
        if (released) return;
        released = true;
        await Promise.all(entries.map((entry) => this.release(entry)));
      } };
  }

  /** Drop slot ownership, not query ownership; later calls also report failures from delayed retirement. */
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      const entries = [...this.current.values(), ...this.previous.values()];
      this.current.clear(); this.previous.clear();
      this.closing = Promise.all(entries.map((entry) => this.release(entry))).then(() => {});
    }
    await this.closing;
    if (this.cleanupFailures) throw new CapabilityGraphError("CG_LOAD_FAILED", {
      nextAction: "repair_source", details: { reason: "view_cleanup_failed", count: this.cleanupFailures },
    });
  }
}

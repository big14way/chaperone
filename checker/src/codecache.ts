// Remembers each recipient's contract code hash so a recent redeploy can be flagged.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface Seen {
  hash: string;
  first_seen_ms: number;
  changed_ms: number | null;
}

export class CodeCache {
  private map: Record<string, Seen> = {};

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) this.map = JSON.parse(readFileSync(path, "utf8")) as Record<string, Seen>;
  }

  /** Record the current hash; return when it last changed (ms), or null if never seen to change. */
  observe(accountId: string, hash: string, nowMs: number): number | null {
    const prev = this.map[accountId];
    if (!prev) {
      this.map[accountId] = { hash, first_seen_ms: nowMs, changed_ms: null };
    } else if (prev.hash !== hash) {
      this.map[accountId] = { hash, first_seen_ms: prev.first_seen_ms, changed_ms: nowMs };
    }
    this.save();
    return this.map[accountId]!.changed_ms;
  }

  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.map, null, 2));
  }
}

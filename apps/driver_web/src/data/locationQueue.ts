/**
 * Fixes waiting to be sent. A port of lib/data/location_queue.dart.
 *
 * - **Bounded, dropping the oldest.** The newest fix is the one that moves the
 *   family's map; the oldest is the one the server is likeliest to refuse.
 * - **Peek, then commit.** A failed flush loses nothing.
 * - **In memory only.** Writing a stream of somebody's locations to storage on
 *   a device that is likely to be lost is worse than a restart re-reading the
 *   last position the server already holds.
 */
import type { Fix } from '../domain/models';

export class LocationQueue {
  private fixes: Fix[] = [];
  private droppedCount = 0;

  constructor(
    readonly capacity = 720,
    /** Matches the server's backlog bound. */
    readonly maxAgeMs = 6 * 60 * 60 * 1000,
  ) {}

  get length(): number {
    return this.fixes.length;
  }

  get isEmpty(): boolean {
    return this.fixes.length === 0;
  }

  /** Surfaced rather than swallowed: silent truncation reads as "all sent". */
  get dropped(): number {
    return this.droppedCount;
  }

  add(fix: Fix): void {
    this.fixes.push(fix);
    while (this.fixes.length > this.capacity) {
      this.fixes.shift();
      this.droppedCount++;
    }
  }

  /** The next batch, oldest first, without removing it. */
  peek(max: number, now: Date): Fix[] {
    const cutoff = now.getTime() - this.maxAgeMs;
    this.fixes = this.fixes.filter((fix) => fix.capturedAt.getTime() >= cutoff);
    return this.fixes.slice(0, max);
  }

  /**
   * Drops what was sent, matched by identity — a fix added while the request
   * was in flight must not be discarded for arriving during the round trip.
   */
  commit(sent: readonly Fix[]): void {
    const done = new Set(sent);
    this.fixes = this.fixes.filter((fix) => !done.has(fix));
  }

  /** Called when a ride ends: its positions are no longer collectable. */
  clear(): void {
    this.fixes = [];
  }
}

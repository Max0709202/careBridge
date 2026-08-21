import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isFlagEnabledFor, type FeatureFlagState } from '../../domain/feature-flags';

/**
 * Reading flags, from anywhere in the system.
 *
 * Cached for a few seconds, and that number is the whole design. Flags are read
 * on hot paths — potentially on every request — and a database round trip for
 * each would make a switch that is off cost as much as one that is on. But a
 * flag is also the thing somebody reaches for when a feature is misbehaving at
 * three in the afternoon, so it has to go off in seconds rather than at the
 * next deploy. Ten seconds is the compromise: fast enough to be free, short
 * enough that "turn it off" means what it says.
 */
@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  private cache = new Map<string, FeatureFlagState>();
  private loadedAt = 0;
  private inFlight: Promise<void> | null = null;

  private static readonly TTL_MS = 10_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whether a flag is on for a subject.
   *
   * `subjectId` is whatever the rollout should be sticky across — usually a
   * user id, sometimes an organisation id when a feature should arrive for a
   * whole operator at once rather than for a random half of their dispatchers.
   */
  async isEnabled(key: string, subjectId: string): Promise<boolean> {
    await this.refreshIfStale();
    return isFlagEnabledFor(this.cache.get(key), subjectId);
  }

  private async refreshIfStale(): Promise<void> {
    if (Date.now() - this.loadedAt < FeatureFlagService.TTL_MS) return;

    // One reload at a time. Without this, a burst of requests arriving just
    // after the cache expires would each start their own query — the classic
    // stampede, and on the one table that is read most often.
    this.inFlight ??= this.reload().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async reload(): Promise<void> {
    try {
      const rows = await this.prisma.featureFlag.findMany();
      this.cache = new Map(
        rows.map((row) => [
          row.key,
          { key: row.key, enabled: row.enabled, rolloutPercent: row.rolloutPercent },
        ]),
      );
      this.loadedAt = Date.now();
    } catch (error) {
      // The previous snapshot is kept and `loadedAt` is not advanced, so the
      // next request tries again. Failing closed here would turn a database
      // hiccup into every feature switching off at once.
      this.logger.warn(
        `Could not reload feature flags: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }
}

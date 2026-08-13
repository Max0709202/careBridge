import { Injectable } from '@nestjs/common';
import type { AppTarget, DevicePlatform } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotFoundError } from '../../common/errors';

export interface DeviceSummary {
  id: string;
  platform: DevicePlatform;
  appTarget: AppTarget;
  lastSeenAt: string;
}

/**
 * FCM registration tokens.
 *
 * Registration is an upsert keyed on the token, because FCM reassigns a token
 * to a different user when a device is handed on or an app is reinstalled by
 * someone else. Creating a second row instead would leave the previous owner's
 * user id attached to a live token — and the next notification for them would
 * arrive on a stranger's phone.
 */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    userId: string,
    input: { token: string; platform: DevicePlatform; appTarget?: AppTarget },
  ): Promise<DeviceSummary> {
    const device = await this.prisma.deviceToken.upsert({
      where: { token: input.token },
      create: {
        userId,
        token: input.token,
        platform: input.platform,
        appTarget: input.appTarget ?? 'family',
      },
      update: {
        // Re-pointed at whoever is registering it now.
        userId,
        platform: input.platform,
        appTarget: input.appTarget ?? 'family',
        lastSeenAt: new Date(),
        revokedAt: null,
        // A token FCM told us was dead has evidently come back.
        invalidatedAt: null,
      },
    });

    return toSummary(device);
  }

  async list(userId: string): Promise<DeviceSummary[]> {
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
    return devices.map(toSummary);
  }

  /**
   * Scoped by `userId` in the `where`, so revoking someone else's device is
   * not something the query can express.
   */
  async revoke(userId: string, deviceId: string): Promise<void> {
    const { count } = await this.prisma.deviceToken.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundError();
  }

  /**
   * Retention: tokens no client has re-registered in a long time.
   *
   * FCM rotates tokens on its own schedule and does not always tell us when
   * one dies, so age is the only signal for a device that simply stopped
   * checking in.
   */
  async purgeStale(before: Date): Promise<number> {
    const { count } = await this.prisma.deviceToken.deleteMany({
      where: {
        OR: [
          { lastSeenAt: { lt: before } },
          { invalidatedAt: { not: null } },
          { revokedAt: { not: null } },
        ],
      },
    });
    return count;
  }
}

function toSummary(device: {
  id: string;
  platform: DevicePlatform;
  appTarget: AppTarget;
  lastSeenAt: Date;
}): DeviceSummary {
  // The token itself is never returned. It is a device identifier and a
  // capability to push to that device; the list only needs to be recognisable.
  return {
    id: device.id,
    platform: device.platform,
    appTarget: device.appTarget,
    lastSeenAt: device.lastSeenAt.toISOString(),
  };
}

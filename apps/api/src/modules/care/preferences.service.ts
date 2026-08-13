import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationError } from '../../common/errors';
import type { UpdatePreferencesDto } from './dto/preferences.dto';

@Injectable()
export class PreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async update(userId: string, dto: UpdatePreferencesDto): Promise<void> {
    if (dto.selectedPatientId != null) {
      // A preference still has to name something the caller may see, or
      // "remember my selection" becomes a way to point the app at a patient
      // the account was never granted.
      const grant = await this.prisma.patientAccess.findUnique({
        where: {
          userId_patientId: { userId, patientId: dto.selectedPatientId },
        },
      });
      if (!grant || grant.revokedAt != null) throw new AuthorizationError();
      if (!grant.permissions.includes('viewProfile')) {
        throw new AuthorizationError();
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.simplifiedMode != null ? { simplifiedMode: dto.simplifiedMode } : {}),
        ...(dto.selectedPatientId != null
          ? { selectedPatientId: dto.selectedPatientId }
          : {}),
      },
    });
  }
}

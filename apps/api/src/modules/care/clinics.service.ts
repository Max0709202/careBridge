import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../../common/request-context';
import type { SaveClinicDto } from './dto/clinic.dto';
import { addressCreate } from './patients.service';

/**
 * Clinics are shared reference data, not patient data: a cardiology practice's
 * address and drop-off instructions reveal nothing about who attends it. Any
 * signed-in user may add one, and every user can see the list — which is the
 * point, since two families sending relatives to the same hospital should not
 * each have to re-type where the car is supposed to stop.
 */
@Injectable()
export class ClinicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    dto: SaveClinicDto,
    ctx: RequestContext,
  ): Promise<string> {
    const clinic = await this.prisma.clinic.create({
      data: {
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        entranceNotes: dto.entranceNotes?.trim() || null,
        operatingNotes: dto.operatingNotes?.trim() || null,
        address: { create: addressCreate(dto.address) },
      },
    });

    await this.audit.record({
      actorUserId: userId,
      action: 'clinic.create',
      entityType: 'Clinic',
      entityId: clinic.id,
      correlationId: ctx.correlationId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return clinic.id;
  }
}

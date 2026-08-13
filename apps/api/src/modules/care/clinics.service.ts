import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../../common/request-context';
import type { SaveClinicDto } from './dto/clinic.dto';
import { addressCreate } from './patients.service';
import { GeocodingService } from './geocoding.service';
import { normaliseZone } from '../../domain/reminder-schedule';

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
    private readonly geocoding: GeocodingService,
  ) {}

  async create(
    userId: string,
    dto: SaveClinicDto,
    ctx: RequestContext,
  ): Promise<string> {
    // Geocoded before the write, so the clinic is never briefly visible
    // without a pin. A failed lookup is a normal outcome, not an error: the
    // clinic is created without coordinates and the record says so.
    const located = await this.geocoding.resolve(dto.address);

    const clinic = await this.prisma.clinic.create({
      data: {
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        entranceNotes: dto.entranceNotes?.trim() || null,
        operatingNotes: dto.operatingNotes?.trim() || null,
        // Appointments inherit this, and reminder offsets are measured
        // against it. Falls back to UTC on a zone we do not recognise, which
        // is visibly wrong and gets reported — unlike a plausible guess.
        timeZone: normaliseZone(dto.timeZone ?? 'America/New_York'),
        address: { create: { ...addressCreate(dto.address), ...located } },
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
      changedFields:
        located.latitude != null ? ['address', 'coordinates'] : ['address'],
    });

    return clinic.id;
  }
}

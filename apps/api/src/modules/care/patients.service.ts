import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationError, NotFoundError } from '../../common/errors';
import { ALL_PERMISSIONS } from '../../domain/permissions';
import type { RequestContext } from '../../common/request-context';
import { CareService } from './care.service';
import type { SavePatientDto, SetPermissionsDto } from './dto/patient.dto';
import type { AddressInput } from './dto/address.dto';
import { GeocodingService } from './geocoding.service';

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly care: CareService,
    private readonly audit: AuditService,
    private readonly geocoding: GeocodingService,
  ) {}

  /**
   * Creating a patient needs no grant — there is nothing yet to have a grant
   * on. Whoever creates the record becomes the **organiser**: full rights, and
   * a grant with `grantedByUserId` null, which is what marks it primary and
   * makes `manageAccess` unremovable.
   */
  async create(
    userId: string,
    dto: SavePatientDto,
    ctx: RequestContext,
  ): Promise<string> {
    // Geocoded before the write, and outside the transaction: it is a network
    // call to a vendor, and holding a database transaction open across one is
    // how a slow third party becomes a table lock.
    //
    // This is the pickup coordinate for every outbound ride the patient ever
    // takes, which makes it the one the "is the car outside yet" countdown is
    // measured to. A home address stored without a pin is a ride with no
    // arrival estimate.
    const located = await this.geocoding.resolve(dto.homeAddress);

    const patientId = await this.prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({
        data: {
          preferredName: dto.preferredName.trim(),
          legalName: dto.legalName?.trim() || null,
          phone: dto.phone.trim(),
          ageBand: dto.ageBand ?? null,
          preferredLanguage: dto.preferredLanguage?.trim() || 'English',
          mobilityNeeds: dto.mobilityNeeds ?? [],
          mobilityNotes: dto.mobilityNotes?.trim() || null,
          preferredClinicId: dto.preferredClinicId ?? null,
          homeAddress: { create: { ...addressCreate(dto.homeAddress), ...located } },
          emergencyContacts: {
            create: (dto.emergencyContacts ?? []).map((c) => ({
              name: c.name.trim(),
              relationship: c.relationship.trim(),
              phone: c.phone.trim(),
              isPrimary: c.isPrimary ?? false,
            })),
          },
          access: {
            create: {
              userId,
              relationship: dto.relationship ?? 'other',
              permissions: [...ALL_PERMISSIONS],
              grantedByUserId: null,
            },
          },
        },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'patient.create',
          entityType: 'Patient',
          entityId: patient.id,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return patient.id;
    });

    // First patient becomes the selection, so a new account lands on something
    // rather than on an empty shell it just filled in.
    await this.prisma.user.updateMany({
      where: { id: userId, selectedPatientId: null },
      data: { selectedPatientId: patientId },
    });

    return patientId;
  }

  /**
   * Editing takes `manageAccess`, not `viewProfile`.
   *
   * A profile is not a read-only description of someone: it holds the pickup
   * address, the access notes a driver navigates by, and the mobility needs
   * that decide which vehicle is sent. Someone who may only *look* at a person
   * must not be able to redirect the car that collects them, or quietly drop a
   * wheelchair requirement.
   */
  async update(
    userId: string,
    patientId: string,
    dto: SavePatientDto,
    ctx: RequestContext,
  ): Promise<void> {
    await this.care.requirePermission(userId, patientId, 'manageAccess');

    const existing = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { homeAddressId: true },
    });
    if (!existing) throw new NotFoundError();

    // Re-resolved on every save, because the address may have changed and a
    // stale pin is worse than none: it sends a car confidently to where
    // somebody used to live.
    const located = await this.geocoding.resolve(dto.homeAddress);

    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({
        where: { id: existing.homeAddressId },
        data: { ...addressCreate(dto.homeAddress), ...located },
      });

      await tx.patient.update({
        where: { id: patientId },
        data: {
          preferredName: dto.preferredName.trim(),
          legalName: dto.legalName?.trim() || null,
          phone: dto.phone.trim(),
          ageBand: dto.ageBand ?? null,
          preferredLanguage: dto.preferredLanguage?.trim() || 'English',
          mobilityNeeds: dto.mobilityNeeds ?? [],
          mobilityNotes: dto.mobilityNotes?.trim() || null,
          preferredClinicId: dto.preferredClinicId ?? null,
        },
      });

      // Contacts are replaced wholesale: the form submits the whole list, and
      // diffing it would let a dropped row survive as a stale contact.
      await tx.emergencyContact.deleteMany({ where: { patientId } });
      if (dto.emergencyContacts?.length) {
        await tx.emergencyContact.createMany({
          data: dto.emergencyContacts.map((c) => ({
            patientId,
            name: c.name.trim(),
            relationship: c.relationship.trim(),
            phone: c.phone.trim(),
            isPrimary: c.isPrimary ?? false,
          })),
        });
      }

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'patient.update',
          entityType: 'Patient',
          entityId: patientId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          // Field names, never values.
          changedFields: [
            'preferredName',
            'legalName',
            'phone',
            'homeAddress',
            'ageBand',
            'mobilityNeeds',
            'mobilityNotes',
            'emergencyContacts',
          ],
        },
        tx,
      );
    });
  }

  /** Same bar as editing, and for the same reason. Soft delete only. */
  async archive(userId: string, patientId: string, ctx: RequestContext): Promise<void> {
    await this.care.requirePermission(userId, patientId, 'manageAccess');

    await this.prisma.$transaction(async (tx) => {
      await tx.patient.update({
        where: { id: patientId },
        data: { archivedAt: new Date() },
      });
      await this.audit.record(
        {
          actorUserId: userId,
          action: 'patient.archive',
          entityType: 'Patient',
          entityId: patientId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );
    });
  }

  /**
   * Edits the caller's **own** grant. Two rules apply.
   *
   * The organiser keeps `manageAccess` whatever the request said — otherwise a
   * family can lock itself out of its own patient with no recovery path.
   *
   * A delegate may only narrow their grant, never widen it. `manageAccess` is
   * the right to administer *other people's* access; letting it write arbitrary
   * permissions back onto the holder's own record would turn it into a
   * self-service route to spending rights the organiser never granted. Giving
   * rights away stays available; taking new ones is not.
   */
  async setPermissions(
    userId: string,
    patientId: string,
    dto: SetPermissionsDto,
    ctx: RequestContext,
  ): Promise<void> {
    const grant = await this.care.requirePermission(userId, patientId, 'manageAccess');

    const requested = new Set(dto.permissions);
    const isPrimary = grant.grantedByUserId == null;

    const effective = isPrimary
      ? [...new Set([...requested, 'manageAccess' as const])]
      : grant.permissions.filter((p) => requested.has(p));

    await this.prisma.$transaction(async (tx) => {
      await tx.patientAccess.update({
        where: { id: grant.id },
        data: { permissions: effective },
      });
      await this.audit.record(
        {
          actorUserId: userId,
          action: 'patient.access.update',
          entityType: 'PatientAccess',
          entityId: grant.id,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['permissions'],
        },
        tx,
      );
    });
  }

  /** Selection is a preference, but it still requires the grant to be real. */
  async select(userId: string, patientId: string): Promise<void> {
    const grant = await this.prisma.patientAccess.findUnique({
      where: { userId_patientId: { userId, patientId } },
    });
    if (!grant || grant.revokedAt != null) throw new AuthorizationError();
    if (!grant.permissions.includes('viewProfile')) throw new AuthorizationError();

    await this.prisma.user.update({
      where: { id: userId },
      data: { selectedPatientId: patientId },
    });
  }
}

function addressCreate(
  input: AddressInput,
): Prisma.AddressCreateWithoutPatientHomesInput {
  return {
    label: input.label.trim(),
    line1: input.line1.trim(),
    line2: input.line2?.trim() || null,
    city: input.city.trim(),
    state: input.state.trim(),
    postalCode: input.postalCode.trim(),
    accessNotes: input.accessNotes?.trim() || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
  };
}

export { addressCreate };

import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { STORAGE, type StoragePort } from '../../infrastructure/storage/storage.port';
import { AuthorizationError, ValidationError } from '../../common/errors';
import type { RequestContext } from '../../common/request-context';
import {
  MAX_DOCUMENT_BYTES,
  assertDocumentTransition,
  complianceOf,
  isAcceptedContentType,
  type ComplianceState,
  type DriverDocumentKind,
} from '../../domain/driver-documents';

/**
 * Driver documents: authorising an upload, confirming it, and deciding it.
 *
 * The bytes never pass through this process. A driver's app is given a URL
 * that permits exactly one PUT of one content type up to one size, for ten
 * minutes; a reviewer is given a URL that permits one GET for two minutes.
 * Everything here is about who may be given which of those, and what the
 * database is allowed to believe as a result.
 *
 * The one rule worth stating twice: **the API confirms the upload against
 * storage rather than trusting the client to report it.** A client that says
 * "done" is a client that could say "done" without having uploaded anything,
 * and an operator would then see a driver as document-complete with an empty
 * object behind the row.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  /**
   * Authorises one upload and creates the slot it will fill.
   *
   * The slot is written **before** the bytes exist, which is deliberate: an
   * abandoned upload then shows as an empty slot an operator can chase, rather
   * than as nothing at all. Retention sweeps the ones that never complete.
   */
  async requestUpload(
    driverId: string,
    input: { kind: DriverDocumentKind; contentType: string; expiresAt?: Date | null },
    actorUserId: string,
    ctx: RequestContext,
  ): Promise<{
    documentId: string;
    url: string;
    headers: Record<string, string>;
    expiresInSeconds: number;
    maxBytes: number;
  }> {
    if (!isAcceptedContentType(input.contentType)) {
      throw new ValidationError(
        'Upload a photo or a PDF — JPEG, PNG, HEIC or PDF.',
        'contentType',
      );
    }

    // Opaque, and generated here. It carries no name, no licence number and no
    // readable identifier, because a bucket listing must not be a roster —
    // and because an object key that encodes anything is an object key
    // somebody will try to guess.
    const storageKey = `driver-documents/${driverId}/${input.kind}/${randomBytes(16).toString('hex')}`;

    const document = await this.prisma.$transaction(async (tx) => {
      // A fresh attempt supersedes whatever was live for this kind. The old
      // row is kept: a renewal must not erase the certificate that covered
      // last month's rides.
      await tx.driverDocument.updateMany({
        where: { driverId, kind: input.kind, supersededAt: null },
        data: { supersededAt: new Date() },
      });

      const created = await tx.driverDocument.create({
        data: {
          driverId,
          kind: input.kind,
          storageKey,
          contentType: input.contentType,
          expiresAt: input.expiresAt ?? null,
          status: 'awaitingUpload',
        },
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'driver.document_upload_authorised',
          entityType: 'DriverDocument',
          entityId: created.id,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          // Field names only. The document itself is never described here.
          changedFields: ['kind', 'storageKey'],
        },
        tx,
      );

      return created;
    });

    const upload = await this.storage.presignUpload({
      key: storageKey,
      contentType: input.contentType,
      maxBytes: MAX_DOCUMENT_BYTES,
    });

    return {
      documentId: document.id,
      url: upload.url,
      headers: upload.headers,
      expiresInSeconds: upload.expiresInSeconds,
      maxBytes: MAX_DOCUMENT_BYTES,
    };
  }

  /**
   * Confirms that the bytes arrived, by asking storage rather than the client.
   *
   * The check is the point. A client reporting its own success could report it
   * without uploading, and the operator would then see a complete file with an
   * empty object behind it.
   */
  async confirmUpload(
    driverId: string,
    documentId: string,
    actorUserId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const document = await this.prisma.driverDocument.findUnique({
      where: { id: documentId },
    });
    if (!document || document.driverId !== driverId) throw new AuthorizationError();

    assertDocumentTransition(document.status, 'submitted');

    const stored = await this.storage.head(document.storageKey);
    if (!stored) {
      throw new ValidationError(
        'We have not received that file yet. Try the upload again.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.driverDocument.update({
        where: { id: documentId },
        data: {
          status: 'submitted',
          submittedAt: new Date(),
          byteSize: stored.byteSize,
          checksum: stored.checksum,
        },
      });

      await this.audit.record(
        {
          actorUserId,
          action: 'driver.document_submitted',
          entityType: 'DriverDocument',
          entityId: documentId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['status', 'byteSize', 'checksum'],
        },
        tx,
      );
    });
  }

  /** A short-lived URL for one reviewer to look at one document. */
  async viewUrl(
    documentId: string,
    actorUserId: string,
    ctx: RequestContext,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const document = await this.prisma.driverDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new AuthorizationError();

    // Audited, and this is the audit row that matters most in the whole
    // feature: it records that a named person looked at a named driver's
    // licence at a given moment. "Who has seen this" is the question an
    // investigation asks, and it cannot be answered after the fact.
    await this.audit.record({
      actorUserId,
      action: 'driver.document_viewed',
      entityType: 'DriverDocument',
      entityId: documentId,
      correlationId: ctx.correlationId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const expiresInSeconds = 120;
    return {
      url: await this.storage.presignDownload({
        key: document.storageKey,
        expiresInSeconds,
      }),
      expiresInSeconds,
    };
  }

  /** Approve or reject, with a reason where one is required. */
  async review(
    documentId: string,
    decision: 'approved' | 'rejected',
    note: string | null,
    actorUserId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const trimmed = note?.trim() || null;
    if (decision === 'rejected' && !trimmed) {
      // Enforced in the database too. "Rejected" with no reason is a driver
      // who re-uploads the same unreadable photograph three times, and a
      // support call nobody can answer.
      throw new ValidationError('Say why the document is being rejected.', 'note');
    }

    await this.prisma.$transaction(async (tx) => {
      const document = await tx.driverDocument.findUnique({
        where: { id: documentId },
      });
      if (!document) throw new AuthorizationError();

      assertDocumentTransition(document.status, decision);

      await tx.driverDocument.update({
        where: { id: documentId },
        data: {
          status: decision,
          reviewedAt: new Date(),
          reviewedByUserId: actorUserId,
          reviewNote: trimmed,
        },
      });

      await this.audit.record(
        {
          actorUserId,
          action: `driver.document_${decision}`,
          entityType: 'DriverDocument',
          entityId: documentId,
          correlationId: ctx.correlationId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          changedFields: ['status', 'reviewedAt', 'reviewedByUserId'],
        },
        tx,
      );
    });
  }

  /** Everything currently held for a driver, newest first. */
  async listFor(driverId: string) {
    return this.prisma.driverDocument.findMany({
      where: { driverId },
      orderBy: [{ supersededAt: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Whether the paperwork permits approving this driver.
   *
   * Read inside the approval transaction as well as offered to the UI, because
   * a check that only the screen performs is a check a second dispatcher can
   * race past.
   */
  async complianceFor(
    driverId: string,
    now: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<ComplianceState> {
    const client = tx ?? this.prisma;
    const documents = await client.driverDocument.findMany({
      where: { driverId, supersededAt: null },
      select: { kind: true, status: true, expiresAt: true },
    });
    return complianceOf(documents, now);
  }
}

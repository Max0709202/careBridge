import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { Prisma } from '@prisma/client';

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  correlationId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /**
   * Field **names** only. Never values — see the note on the AuditLog model.
   */
  changedFields?: string[];
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an audit row inside the caller's transaction when one is supplied.
   *
   * Passing the transaction client matters: an audited action must not be able
   * to succeed unaudited. If the audit write fails, the change it describes
   * rolls back with it.
   */
  async record(
    entry: AuditEntry,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          correlationId: entry.correlationId ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          changedFields: entry.changedFields ?? [],
        },
      });
    } catch (error) {
      if (tx) throw error;
      // Outside a transaction there is nothing to roll back, and losing the
      // request over a failed audit write would be the worse outcome.
      this.logger.error(`Audit write failed for ${entry.action}`, error);
    }
  }
}

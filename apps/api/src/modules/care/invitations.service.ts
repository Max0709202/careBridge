import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FamilyPermission, RelationshipType } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CareService } from './care.service';
import { APP_CONFIG } from '../../common/config.token';
import type { AppConfig } from '../../common/config';
import { MAIL, type MailPort } from '../../infrastructure/mail/mail.port';
import {
  AuthorizationError,
  ConflictError,
  ValidationError,
} from '../../common/errors';
import { hashToken, mintToken } from '../auth/crypto';
import { invitationEmail } from '../auth/mail-templates';

export interface InvitationSummary {
  id: string;
  patientId: string;
  /**
   * Masked. The list is shown to everyone who can manage access, and the full
   * address of a person who has not yet accepted is more than that audience
   * needs to recognise their own outstanding invitation.
   */
  emailHint: string;
  relationship: RelationshipType;
  permissions: FamilyPermission[];
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

/**
 * Family invitations.
 *
 * FOUNDATION §5 names this as an account-takeover vector, and it is the
 * sharpest one in Stage 2: what an invitation grants is standing access to a
 * vulnerable person's home address, appointment schedule and live location.
 *
 * Four properties contain that, and each exists because of a specific way the
 * feature goes wrong without it:
 *
 *   1. **Email-bound.** Acceptance requires being signed in as the invited
 *      address. Without this, the link *is* the grant, and links travel —
 *      through forwarded mail, shared family inboxes, and screenshots in group
 *      chats.
 *   2. **Verified-address-bound.** The accepting account's address must be
 *      verified. Otherwise anyone can register with the invited address and
 *      accept, and the binding in (1) proves nothing.
 *   3. **Single-use, consumed transactionally.** Two taps on one link must not
 *      produce two grants, and a race must not produce a grant plus an error.
 *   4. **Expiring, with bounded guessing.** A stale invitation in an archived
 *      inbox stops being a credential, and a token being hammered is revoked
 *      rather than being allowed to be a guessing target.
 *
 * The token is stored only as a digest, so a database dump is not a set of
 * live invitations.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly care: CareService,
    private readonly audit: AuditService,
    @Inject(MAIL) private readonly mail: MailPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Enough failed presentations to be a guessing attempt rather than a fumble. */
  private static readonly MAX_ATTEMPTS = 10;

  async invite(
    inviterUserId: string,
    patientId: string,
    input: {
      email: string;
      relationship: RelationshipType;
      permissions: FamilyPermission[];
    },
    ctx: AuditContext = {},
  ): Promise<InvitationSummary> {
    // Only someone who can manage access may hand it out. Resolved through the
    // one policy implementation — this module does not re-derive it.
    await this.care.requirePermission(inviterUserId, patientId, 'manageAccess');

    const inviter = await this.prisma.user.findUniqueOrThrow({
      where: { id: inviterUserId },
      select: { fullName: true, email: true, emailVerifiedAt: true },
    });

    // An unverified inviter is an unproven mailbox. Letting one issue
    // invitations would let somebody register with a stranger's address, invite
    // themselves elsewhere, and build a graph of grants from an account they
    // never proved they own.
    if (inviter.emailVerifiedAt == null) {
      throw new ValidationError(
        'Confirm your own email address before inviting someone.',
      );
    }

    const email = normaliseEmail(input.email);

    if (email === inviter.email) {
      throw new ValidationError('You already have access to this patient.');
    }

    if (input.permissions.length === 0) {
      throw new ValidationError('Choose at least one permission to grant.');
    }

    // `viewProfile` is the floor every other permission stands on: a grant
    // that can schedule but not view is not a coherent thing to offer.
    if (!input.permissions.includes('viewProfile')) {
      throw new ValidationError(
        'Every kind of access includes being able to see the patient’s profile.',
      );
    }

    // Nobody may hand out more than they hold. Without this, a family member
    // with view-only access could invite an accomplice as a full manager.
    const inviterGrant = await this.prisma.patientAccess.findUniqueOrThrow({
      where: { userId_patientId: { userId: inviterUserId, patientId } },
    });
    const beyond = input.permissions.filter(
      (permission) => !inviterGrant.permissions.includes(permission),
    );
    if (beyond.length > 0) {
      throw new ValidationError('You can only give access you already have yourself.');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      const existingGrant = await this.prisma.patientAccess.findUnique({
        where: { userId_patientId: { userId: existingUser.id, patientId } },
      });
      if (existingGrant && existingGrant.revokedAt == null) {
        throw new ConflictError('That person already has access to this patient.');
      }
    }

    const token = mintToken();
    const expiresAt = new Date(
      Date.now() + this.config.INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    const invitation = await this.prisma.$transaction(async (tx) => {
      // One live invitation per address per patient. Re-inviting supersedes
      // rather than accumulating, so a person who was invited three times has
      // one working link and not three.
      await tx.patientInvitation.updateMany({
        where: { patientId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'superseded' },
      });

      const created = await tx.patientInvitation.create({
        data: {
          patientId,
          email,
          tokenHash: hashToken(token),
          relationship: input.relationship,
          permissions: input.permissions,
          invitedByUserId: inviterUserId,
          expiresAt,
        },
      });

      await this.audit.record(
        {
          actorUserId: inviterUserId,
          action: 'patient.invitation.created',
          entityType: 'PatientInvitation',
          entityId: created.id,
          changedFields: ['email', 'relationship', 'permissions'],
          ...ctx,
        },
        tx,
      );

      return created;
    });

    await this.mail
      .send(
        invitationEmail(
          {
            appUrl: this.config.PUBLIC_APP_URL,
            correlationId: ctx.correlationId ?? undefined,
          },
          {
            to: email,
            token,
            inviterFirstName: firstNameOf(inviter.fullName),
            expiresInDays: this.config.INVITATION_TTL_DAYS,
          },
        ),
      )
      .catch((error: unknown) => {
        this.logger.error(
          `Could not send an invitation email: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });

    return toSummary(invitation);
  }

  /**
   * Accepts an invitation, or explains why not.
   *
   * Everything happens in one transaction: the token is consumed, the grant is
   * written and the audit row lands together, so a crash between them cannot
   * leave a spent token with no access or access with no record.
   */
  async accept(
    userId: string,
    token: string,
    ctx: AuditContext = {},
  ): Promise<{ patientId: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.patientInvitation.findUnique({
        where: { tokenHash: hashToken(token) },
      });

      // One message for every failure mode. "Expired", "already used" and
      // "never existed" must not be tellable apart, or the endpoint becomes a
      // way to probe which tokens are close.
      const invalid = new ValidationError(
        'That invitation is no longer valid. Ask for a new one.',
      );

      if (!invitation) throw invalid;

      if (
        invitation.acceptedAt != null ||
        invitation.revokedAt != null ||
        invitation.expiresAt.getTime() <= Date.now()
      ) {
        throw invalid;
      }

      if (invitation.attemptCount >= InvitationsService.MAX_ATTEMPTS) {
        throw invalid;
      }

      // Email binding. The signed-in account must *be* the invitee, and must
      // have proved it owns that mailbox — otherwise the binding is satisfied
      // by anyone who can type the address into a registration form.
      if (user.email !== invitation.email || user.emailVerifiedAt == null) {
        await tx.patientInvitation.update({
          where: { id: invitation.id },
          data: { attemptCount: { increment: 1 } },
        });

        await this.audit.record(
          {
            actorUserId: userId,
            action: 'patient.invitation.rejected',
            entityType: 'PatientInvitation',
            entityId: invitation.id,
            ...ctx,
          },
          tx,
        );

        throw user.emailVerifiedAt == null
          ? new ValidationError(
              'Confirm your email address before accepting an invitation.',
            )
          : invalid;
      }

      // Conditional update, so two concurrent accepts cannot both win. The
      // count is the arbiter, not the read above.
      const claimed = await tx.patientInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), acceptedByUserId: userId },
      });
      if (claimed.count !== 1) throw invalid;

      // An earlier revoked grant is reinstated rather than duplicated — the
      // unique constraint on (userId, patientId) means there is only ever one
      // edge, and its history is the audit log.
      await tx.patientAccess.upsert({
        where: { userId_patientId: { userId, patientId: invitation.patientId } },
        create: {
          userId,
          patientId: invitation.patientId,
          relationship: invitation.relationship,
          permissions: invitation.permissions,
          grantedByUserId: invitation.invitedByUserId,
        },
        update: {
          relationship: invitation.relationship,
          permissions: invitation.permissions,
          grantedByUserId: invitation.invitedByUserId,
          grantedAt: new Date(),
          revokedAt: null,
        },
      });

      await this.audit.record(
        {
          actorUserId: userId,
          action: 'patient.invitation.accepted',
          entityType: 'PatientAccess',
          entityId: invitation.patientId,
          changedFields: ['permissions', 'relationship'],
          ...ctx,
        },
        tx,
      );

      await this.care.notifyPatientCircle(tx, invitation.patientId, {
        kind: 'accessGranted',
        title: 'Someone joined the care circle',
        body: 'Open CareBridge to see who now has access.',
      });

      return { patientId: invitation.patientId };
    });
  }

  async list(userId: string, patientId: string): Promise<InvitationSummary[]> {
    await this.care.requirePermission(userId, patientId, 'manageAccess');

    const invitations = await this.prisma.patientInvitation.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return invitations.map(toSummary);
  }

  async revoke(
    userId: string,
    patientId: string,
    invitationId: string,
    ctx: AuditContext = {},
  ): Promise<void> {
    await this.care.requirePermission(userId, patientId, 'manageAccess');

    // Scoped by patient in the `where`, so an id belonging to another family's
    // patient matches nothing rather than being checked afterwards.
    const { count } = await this.prisma.patientInvitation.updateMany({
      where: { id: invitationId, patientId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' },
    });

    if (count === 0) throw new AuthorizationError();

    await this.audit.record({
      actorUserId: userId,
      action: 'patient.invitation.revoked',
      entityType: 'PatientInvitation',
      entityId: invitationId,
      ...ctx,
    });
  }

  /** Retention: a long-expired invitation has no evidentiary value. */
  async purgeExpired(before: Date): Promise<number> {
    const { count } = await this.prisma.patientInvitation.deleteMany({
      where: { acceptedAt: null, expiresAt: { lt: before } },
    });
    return count;
  }
}

interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function firstNameOf(fullName: string): string {
  // `''.split(/\s+/)` is `['']`, not `[]` — so a `?? 'Someone'` fallback never
  // fires and the invitation email opens with " has invited you".
  const [first] = fullName.trim().split(/\s+/).filter(Boolean);
  return first ?? 'Someone';
}

/**
 * `a•••@example.com` — enough for the recipient to recognise their own
 * address, not enough for a bystander to harvest one.
 */
function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const head = local.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

function toSummary(invitation: {
  id: string;
  patientId: string;
  email: string;
  relationship: RelationshipType;
  permissions: FamilyPermission[];
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}): InvitationSummary {
  const status: InvitationSummary['status'] =
    invitation.acceptedAt != null
      ? 'accepted'
      : invitation.revokedAt != null
        ? 'revoked'
        : invitation.expiresAt.getTime() <= Date.now()
          ? 'expired'
          : 'pending';

  return {
    id: invitation.id,
    patientId: invitation.patientId,
    emailHint: maskEmail(invitation.email),
    relationship: invitation.relationship,
    permissions: invitation.permissions,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    status,
  };
}

/** Exported for the unit test; the masking rule is easy to get subtly wrong. */
export const __testing = { maskEmail, firstNameOf };

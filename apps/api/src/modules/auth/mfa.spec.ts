import { MfaService } from './mfa.service';
import type { AppConfig } from '../../common/config';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

/**
 * The one branch that cannot be reached from the integration suite.
 *
 * `mfa.e2e-spec.ts` runs with an encryption key configured, because otherwise
 * it could only ever test the refusal. This tests the refusal — and it is a
 * unit test because what it exercises is a decision about configuration, taken
 * before any I/O happens.
 */
describe('MFA without an encryption key', () => {
  /**
   * Deliberately a bare object rather than a mock library. If `beginEnrolment`
   * ever touches the database before checking the key, this throws a
   * `TypeError` instead of a `ConflictError` and the test fails — which is
   * exactly the regression worth catching.
   */
  const unusablePrisma = {} as PrismaService;
  const unusableAudit = {} as AuditService;

  const configWithoutKey = { mfaSecretKey: null } as AppConfig;

  it('refuses enrolment rather than storing a secret in the clear', async () => {
    // A user told "two-factor is on" while the secret sits unencrypted has
    // been given a false belief about their own security, which is worse than
    // the feature being unavailable.
    const service = new MfaService(unusablePrisma, unusableAudit, configWithoutKey);

    await expect(
      service.beginEnrolment('user-1', 'someone@example.test'),
    ).rejects.toThrow(/MFA_SECRET_KEY/);
  });

  it('refuses confirmation for the same reason', async () => {
    const service = new MfaService(unusablePrisma, unusableAudit, configWithoutKey);

    await expect(service.confirmEnrolment('user-1', '123456')).rejects.toThrow(
      /MFA_SECRET_KEY/,
    );
  });

  it('reports a code as invalid rather than throwing at sign-in', async () => {
    // Login must not 500 because a deployment is missing an optional key. It
    // simply cannot verify, so the answer is "no".
    const service = new MfaService(unusablePrisma, unusableAudit, configWithoutKey);

    await expect(service.verify('user-1', '123456')).resolves.toBe(false);
  });
});

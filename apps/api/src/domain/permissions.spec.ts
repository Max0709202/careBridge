import {
  ALL_PERMISSIONS,
  DEFAULT_INVITED_PERMISSIONS,
  grantAllows,
  isActiveGrant,
  isPrimaryGrant,
  type AccessGrant,
  type FamilyPermission,
} from './permissions';

/**
 * The server's copy of the access model, which is the one that decides
 * anything — lib/domain/permissions.dart hides buttons and is tested
 * separately in test/permissions_test.dart. The two are asserted against the
 * same cases on purpose: a divergence shows up as a control the app offers and
 * the API refuses, or worse, the reverse.
 */
describe('family access grants', () => {
  const grant = (overrides: Partial<AccessGrant> = {}): AccessGrant => ({
    userId: 'user-1',
    patientId: 'patient-1',
    relationship: 'daughter',
    permissions: [...DEFAULT_INVITED_PERMISSIONS],
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    grantedByUserId: 'user-2',
    revokedAt: null,
    ...overrides,
  });

  it('permits exactly what the grant lists', () => {
    const invited = grant();

    expect(grantAllows(invited, 'viewProfile')).toBe(true);
    expect(grantAllows(invited, 'scheduleAppointments')).toBe(true);
    expect(grantAllows(invited, 'requestTransport')).toBe(true);
    expect(grantAllows(invited, 'makePayments')).toBe(false);
    expect(grantAllows(invited, 'manageAccess')).toBe(false);
  });

  it('permits nothing at all once revoked', () => {
    // Revocation is the whole point of the column: it has to beat an explicit
    // permission list, not be one more thing checked alongside it.
    const revoked = grant({
      permissions: [...ALL_PERMISSIONS],
      revokedAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(isActiveGrant(revoked)).toBe(false);
    for (const permission of ALL_PERMISSIONS) {
      expect(grantAllows(revoked, permission)).toBe(false);
    }
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('permits nothing when the grant is %s', (_label, absent) => {
    // A user with no grant on this patient reaches here as a lookup that found
    // nothing. It must read as "no", never as a crash the caller might catch
    // and treat as something else.
    expect(isActiveGrant(absent)).toBe(false);
    for (const permission of ALL_PERMISSIONS) {
      expect(grantAllows(absent, permission)).toBe(false);
    }
  });

  it('treats the grant with no granter as the organiser', () => {
    expect(isPrimaryGrant(grant({ grantedByUserId: null }))).toBe(true);
    expect(isPrimaryGrant(grant())).toBe(false);
  });

  it('does not hand an invited relative money or access control by default', () => {
    // The default is what an invitation accepted without further thought
    // produces, so it is the permission set most grants in the system will
    // actually have.
    expect([...DEFAULT_INVITED_PERMISSIONS]).toEqual([
      'viewProfile',
      'scheduleAppointments',
      'requestTransport',
    ]);
    expect(DEFAULT_INVITED_PERMISSIONS).not.toContain('makePayments');
    expect(DEFAULT_INVITED_PERMISSIONS).not.toContain('manageAccess');
  });

  it('lists every permission in ALL_PERMISSIONS', () => {
    // ALL_PERMISSIONS is what the organiser's grant is built from and what the
    // revocation test above iterates. A permission added to the union type and
    // forgotten here would be one this file silently stops checking.
    const declared: FamilyPermission[] = [
      'viewProfile',
      'scheduleAppointments',
      'requestTransport',
      'makePayments',
      'manageAccess',
    ];
    expect([...ALL_PERMISSIONS].sort()).toEqual(declared.sort());
  });
});

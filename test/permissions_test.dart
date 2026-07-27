import 'package:carebridge_family/domain/permissions.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  PatientAccess access({
    required Set<FamilyPermission> permissions,
    String? grantedBy,
    DateTime? revokedAt,
  }) {
    return PatientAccess(
      userId: 'user-1',
      patientId: 'patient-1',
      relationship: RelationshipType.daughter,
      permissions: permissions,
      grantedAt: DateTime.utc(2026, 1, 1),
      grantedByUserId: grantedBy,
      revokedAt: revokedAt,
    );
  }

  group('patient access', () {
    test('grants only what it holds', () {
      final grant = access(permissions: PatientAccess.defaultInvited);

      expect(grant.can(FamilyPermission.viewProfile), isTrue);
      expect(grant.can(FamilyPermission.requestTransport), isTrue);
      expect(grant.can(FamilyPermission.makePayments), isFalse);
      expect(grant.can(FamilyPermission.manageAccess), isFalse);
    });

    test('a revoked grant permits nothing at all', () {
      final grant = access(
        permissions: PatientAccess.all,
        revokedAt: DateTime.utc(2026, 6, 1),
      );

      expect(grant.isActive, isFalse);
      for (final permission in FamilyPermission.values) {
        expect(
          grant.can(permission),
          isFalse,
          reason: 'revoked access must not permit ${permission.name}',
        );
      }
    });

    test('view-only access cannot spend money or change access', () {
      final grant = access(permissions: PatientAccess.viewOnly);

      expect(grant.can(FamilyPermission.viewProfile), isTrue);
      expect(grant.can(FamilyPermission.scheduleAppointments), isFalse);
      expect(grant.can(FamilyPermission.requestTransport), isFalse);
      expect(grant.can(FamilyPermission.makePayments), isFalse);
      expect(grant.can(FamilyPermission.manageAccess), isFalse);
    });

    test('the organiser is the grant with no granter', () {
      expect(access(permissions: PatientAccess.all).isPrimary, isTrue);
      expect(
        access(permissions: PatientAccess.all, grantedBy: 'user-2').isPrimary,
        isFalse,
      );
    });

    test('revoking is reversible through copyWith', () {
      final revoked = access(
        permissions: PatientAccess.all,
        revokedAt: DateTime.utc(2026, 6, 1),
      );
      expect(revoked.copyWith(clearRevokedAt: true).isActive, isTrue);
    });

    test('every permission and relationship has a readable label', () {
      for (final permission in FamilyPermission.values) {
        expect(permission.label, isNotEmpty);
      }
      for (final relationship in RelationshipType.values) {
        expect(relationship.label, isNotEmpty);
      }
    });
  });
}

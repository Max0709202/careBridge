/// Family access control.
///
/// This is the authorisation edge the whole product turns on: a user's rights
/// are never global, they are held *per patient* through a [PatientAccess]
/// grant. "Can Sarah book a ride?" is meaningless; "can Sarah book a ride for
/// Eleanor?" is the only answerable form.
///
/// Enforced here on the client so controls can be hidden — and re-enforced on
/// the server, which is authoritative. Hiding a button is a courtesy, not a
/// control.
library;

enum FamilyPermission {
  viewProfile,
  scheduleAppointments,
  requestTransport,
  makePayments,
  manageAccess;

  String get label => switch (this) {
        FamilyPermission.viewProfile => 'View profile and history',
        FamilyPermission.scheduleAppointments => 'Create and change appointments',
        FamilyPermission.requestTransport => 'Request transportation',
        FamilyPermission.makePayments => 'Pay for rides and subscription',
        FamilyPermission.manageAccess => 'Invite and remove family members',
      };
}

enum RelationshipType {
  son,
  daughter,
  spouse,
  sibling,
  grandchild,
  friend,
  professionalCaregiver,
  other;

  String get label => switch (this) {
        RelationshipType.son => 'Son',
        RelationshipType.daughter => 'Daughter',
        RelationshipType.spouse => 'Spouse or partner',
        RelationshipType.sibling => 'Sibling',
        RelationshipType.grandchild => 'Grandchild',
        RelationshipType.friend => 'Friend',
        RelationshipType.professionalCaregiver => 'Professional caregiver',
        RelationshipType.other => 'Other',
      };
}

/// A grant of access to one patient, held by one user.
class PatientAccess {
  const PatientAccess({
    required this.userId,
    required this.patientId,
    required this.relationship,
    required this.permissions,
    required this.grantedAt,
    this.grantedByUserId,
    this.revokedAt,
  });

  final String userId;
  final String patientId;
  final RelationshipType relationship;
  final Set<FamilyPermission> permissions;
  final DateTime grantedAt;
  final String? grantedByUserId;
  final DateTime? revokedAt;

  bool get isActive => revokedAt == null;

  /// The organiser who created the patient record. Holds every permission and
  /// cannot have `manageAccess` removed — otherwise a family can lock itself out
  /// of its own patient with no recovery path short of support.
  bool get isPrimary => grantedByUserId == null;

  bool can(FamilyPermission permission) =>
      isActive && permissions.contains(permission);

  PatientAccess copyWith({
    Set<FamilyPermission>? permissions,
    RelationshipType? relationship,
    DateTime? revokedAt,
    bool clearRevokedAt = false,
  }) {
    return PatientAccess(
      userId: userId,
      patientId: patientId,
      relationship: relationship ?? this.relationship,
      permissions: permissions ?? this.permissions,
      grantedAt: grantedAt,
      grantedByUserId: grantedByUserId,
      revokedAt: clearRevokedAt ? null : (revokedAt ?? this.revokedAt),
    );
  }

  static const Set<FamilyPermission> all = {
    FamilyPermission.viewProfile,
    FamilyPermission.scheduleAppointments,
    FamilyPermission.requestTransport,
    FamilyPermission.makePayments,
    FamilyPermission.manageAccess,
  };

  /// Sensible default for an invited relative: they can see what is happening
  /// and help with logistics, but cannot spend money or change who has access
  /// until the organiser grants it.
  static const Set<FamilyPermission> defaultInvited = {
    FamilyPermission.viewProfile,
    FamilyPermission.scheduleAppointments,
    FamilyPermission.requestTransport,
  };

  /// View-only: for a relative who wants reassurance, not responsibility.
  static const Set<FamilyPermission> viewOnly = {FamilyPermission.viewProfile};
}

/**
 * Family access control. Rights are never global: they are held *per patient*
 * through a PatientAccess grant. Enforced here only so controls can be hidden —
 * the server re-checks every request. Mirrors lib/domain/permissions.dart.
 */

export const FAMILY_PERMISSIONS = [
  'viewProfile',
  'scheduleAppointments',
  'requestTransport',
  'makePayments',
  'manageAccess',
] as const;
export type FamilyPermission = (typeof FAMILY_PERMISSIONS)[number];

export const permissionLabel: Record<FamilyPermission, string> = {
  viewProfile: 'View profile and history',
  scheduleAppointments: 'Create and change appointments',
  requestTransport: 'Request transportation',
  makePayments: 'Pay for rides and subscription',
  manageAccess: 'Invite and remove family members',
};

export const RELATIONSHIP_TYPES = [
  'son',
  'daughter',
  'spouse',
  'sibling',
  'grandchild',
  'friend',
  'professionalCaregiver',
  'other',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const relationshipLabel: Record<RelationshipType, string> = {
  son: 'Son',
  daughter: 'Daughter',
  spouse: 'Spouse or partner',
  sibling: 'Sibling',
  grandchild: 'Grandchild',
  friend: 'Friend',
  professionalCaregiver: 'Professional caregiver',
  other: 'Other',
};

export interface PatientAccess {
  userId: string;
  patientId: string;
  relationship: RelationshipType;
  permissions: Set<FamilyPermission>;
  grantedAt: Date;
  grantedByUserId: string | null;
  revokedAt: Date | null;
}

export const accessIsActive = (access: PatientAccess) => access.revokedAt === null;

/**
 * The organiser who created the record: holds every permission, and cannot have
 * `manageAccess` removed — otherwise a family can lock itself out.
 */
export const accessIsPrimary = (access: PatientAccess) =>
  access.grantedByUserId === null;

export const accessCan = (access: PatientAccess, permission: FamilyPermission) =>
  accessIsActive(access) && access.permissions.has(permission);

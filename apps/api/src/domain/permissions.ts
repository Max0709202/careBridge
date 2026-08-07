/**
 * Family access control. Mirrors lib/domain/permissions.dart.
 *
 * The authorisation edge the whole product turns on: rights are never global,
 * they are held *per patient*. "Can Sarah book a ride?" is meaningless; "can
 * Sarah book a ride for Eleanor?" is the only answerable form.
 *
 * The client enforces this too, so controls can be hidden. Hiding a button is a
 * courtesy; this file is the control.
 */

export type FamilyPermission =
  | 'viewProfile'
  | 'scheduleAppointments'
  | 'requestTransport'
  | 'makePayments'
  | 'manageAccess';

export type RelationshipType =
  | 'son'
  | 'daughter'
  | 'spouse'
  | 'sibling'
  | 'grandchild'
  | 'friend'
  | 'professionalCaregiver'
  | 'other';

export const ALL_PERMISSIONS: readonly FamilyPermission[] = [
  'viewProfile',
  'scheduleAppointments',
  'requestTransport',
  'makePayments',
  'manageAccess',
];

/**
 * Sensible default for an invited relative: they can see what is happening and
 * help with logistics, but cannot spend money or change who has access until
 * the organiser grants it.
 */
export const DEFAULT_INVITED_PERMISSIONS: readonly FamilyPermission[] = [
  'viewProfile',
  'scheduleAppointments',
  'requestTransport',
];

export interface AccessGrant {
  userId: string;
  patientId: string;
  relationship: RelationshipType;
  permissions: FamilyPermission[];
  grantedAt: Date;
  grantedByUserId: string | null;
  revokedAt: Date | null;
}

export function isActiveGrant(grant: AccessGrant | null | undefined): boolean {
  return grant != null && grant.revokedAt == null;
}

/**
 * The organiser who created the patient record. Holds every permission and
 * cannot have `manageAccess` removed — otherwise a family can lock itself out
 * of its own patient with no recovery path short of support.
 */
export function isPrimaryGrant(grant: AccessGrant): boolean {
  return grant.grantedByUserId == null;
}

export function grantAllows(
  grant: AccessGrant | null | undefined,
  permission: FamilyPermission,
): boolean {
  return isActiveGrant(grant) && grant!.permissions.includes(permission);
}

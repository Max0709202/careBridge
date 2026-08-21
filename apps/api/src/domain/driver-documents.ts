import { InvalidTransitionError } from '../common/errors';

/**
 * What a driver has to hand in, and what happens to it.
 *
 * The list is short and every entry is a legal requirement rather than a
 * preference. That restraint is the rule: a transport operator has no business
 * holding a driver's passport because an upload form happened to allow one, and
 * the way to guarantee that is for the server to reject a kind it does not
 * recognise rather than to store whatever arrives.
 */
export type DriverDocumentKind =
  | 'driversLicence'
  | 'vehicleInsurance'
  | 'vehicleRegistration'
  | 'backgroundCheck';

export const DRIVER_DOCUMENT_KINDS: readonly DriverDocumentKind[] = [
  'driversLicence',
  'vehicleInsurance',
  'vehicleRegistration',
  'backgroundCheck',
];

export type DriverDocumentStatus =
  | 'awaitingUpload'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'expired';

export const DRIVER_DOCUMENT_STATUSES: readonly DriverDocumentStatus[] = [
  'awaitingUpload',
  'submitted',
  'approved',
  'rejected',
  'expired',
];

/**
 * The documents that must be approved before a driver may carry anybody.
 *
 * `backgroundCheck` is deliberately **not** here, and the omission is a
 * product position rather than an oversight. A platform check is a database
 * lookup of variable quality and coverage; treating it as the thing that makes
 * somebody safe would be a claim this product does not make and cannot
 * support. The operator decides who to employ. What the system enforces is
 * that the legal minimum — a licence, insurance on the vehicle, and the
 * registration that ties the vehicle to it — is present and current.
 */
export const REQUIRED_FOR_APPROVAL: readonly DriverDocumentKind[] = [
  'driversLicence',
  'vehicleInsurance',
  'vehicleRegistration',
];

/**
 * File types accepted, mapped to what an upload slot may be signed for.
 *
 * An allow-list rather than a deny-list, and short: these are the things a
 * phone camera and a scanner produce. Anything else is a file somebody is
 * trying to put in a bucket for a reason other than the one the form is for.
 */
export const ACCEPTED_CONTENT_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
];

/**
 * The largest upload an operator will accept.
 *
 * Ten megabytes covers a modern phone photograph and a multi-page scan. It is
 * signed into the upload URL, so it is a bound rather than a request.
 */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * How long before a document's own expiry the operator is warned.
 *
 * Thirty days is enough notice to renew an insurance policy without a gap. The
 * alternative — telling somebody on the morning it lapses — takes a driver off
 * the road on a day their rides are already booked.
 */
export const DOCUMENT_EXPIRY_WARNING_DAYS = 30;

const ALLOWED: Record<DriverDocumentStatus, readonly DriverDocumentStatus[]> = {
  // The slot exists; the bytes have not arrived. An abandoned upload stays
  // here, visible as an empty slot rather than as nothing at all.
  awaitingUpload: ['submitted'],
  submitted: ['approved', 'rejected'],
  // A renewal supersedes rather than re-opens: the row that covered last
  // month's rides has to stay as it was.
  approved: ['expired'],
  rejected: [],
  expired: [],
};

export function canTransitionDocument(
  from: DriverDocumentStatus,
  to: DriverDocumentStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

export function assertDocumentTransition(
  from: DriverDocumentStatus,
  to: DriverDocumentStatus,
): void {
  if (!canTransitionDocument(from, to)) throw new InvalidTransitionError(from, to);
}

/** Whether this document currently counts towards a driver being approvable. */
export function countsAsValid(
  document: {
    kind: DriverDocumentKind;
    status: DriverDocumentStatus;
    expiresAt: Date | null;
  },
  now: Date,
): boolean {
  if (document.status !== 'approved') return false;
  // An approved certificate that has passed its printed date is not valid,
  // whatever the row still says. The sweep that flips the status runs daily,
  // and a driver must not be assignable in the hours between.
  if (document.expiresAt && document.expiresAt <= now) return false;
  return true;
}

export interface ComplianceState {
  /** Every required kind present, approved and unexpired. */
  compliant: boolean;
  missing: DriverDocumentKind[];
  expiringSoon: DriverDocumentKind[];
}

/**
 * Whether an operator may approve this driver.
 *
 * Separate from `assertDriverTransition`, which asks whether the *lifecycle*
 * permits the move. This asks whether the paperwork does. Keeping them apart
 * means the state machine stays a state machine and does not grow a document
 * table inside it.
 */
export function complianceOf(
  documents: readonly {
    kind: DriverDocumentKind;
    status: DriverDocumentStatus;
    expiresAt: Date | null;
  }[],
  now: Date,
): ComplianceState {
  const valid = documents.filter((document) => countsAsValid(document, now));
  const held = new Set(valid.map((document) => document.kind));

  const warningThreshold = new Date(
    now.getTime() + DOCUMENT_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000,
  );

  return {
    compliant: REQUIRED_FOR_APPROVAL.every((kind) => held.has(kind)),
    missing: REQUIRED_FOR_APPROVAL.filter((kind) => !held.has(kind)),
    // Sorted into the canonical order rather than document order, so a UI
    // listing them twice does not list them differently.
    expiringSoon: REQUIRED_FOR_APPROVAL.filter((kind) =>
      valid.some(
        (document) =>
          document.kind === kind &&
          document.expiresAt !== null &&
          document.expiresAt <= warningThreshold,
      ),
    ),
  };
}

/**
 * Whether a content type may be signed for.
 *
 * Compared case-insensitively and with any `; charset=` parameter stripped,
 * because a browser will send `image/jpeg` and a scanner will send
 * `image/jpeg; charset=binary`, and refusing the second would be refusing a
 * legitimate upload over punctuation.
 */
export function isAcceptedContentType(contentType: string): boolean {
  const bare = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return ACCEPTED_CONTENT_TYPES.includes(bare);
}

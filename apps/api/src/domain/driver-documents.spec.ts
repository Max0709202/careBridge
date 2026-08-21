import {
  ACCEPTED_CONTENT_TYPES,
  DOCUMENT_EXPIRY_WARNING_DAYS,
  DRIVER_DOCUMENT_KINDS,
  DRIVER_DOCUMENT_STATUSES,
  MAX_DOCUMENT_BYTES,
  REQUIRED_FOR_APPROVAL,
  assertDocumentTransition,
  canTransitionDocument,
  complianceOf,
  countsAsValid,
  isAcceptedContentType,
  type DriverDocumentKind,
  type DriverDocumentStatus,
} from './driver-documents';
import { InvalidTransitionError } from '../common/errors';

/**
 * The paperwork rules.
 *
 * Two of these carry real weight. An **expired** certificate must stop
 * counting the moment it expires rather than the next time a sweep runs, or
 * there is a window in which somebody drives uninsured with the system's
 * blessing. And a **background check is not what makes a driver safe** — it is
 * collected, and it is deliberately not what the gate turns on.
 */

const now = new Date('2026-06-15T12:00:00Z');

function doc(
  kind: DriverDocumentKind,
  overrides: Partial<{ status: DriverDocumentStatus; expiresAt: Date | null }> = {},
) {
  return {
    kind,
    status: overrides.status ?? 'approved',
    expiresAt: overrides.expiresAt ?? null,
  };
}

const fullSet = REQUIRED_FOR_APPROVAL.map((kind) => doc(kind));

describe('what is collected', () => {
  it('is a short list of legal requirements and nothing else', () => {
    // A transport operator has no business holding a driver's passport because
    // an upload form happened to allow one.
    expect([...DRIVER_DOCUMENT_KINDS]).toEqual([
      'driversLicence',
      'vehicleInsurance',
      'vehicleRegistration',
      'backgroundCheck',
    ]);
  });

  it('accepts what a phone camera and a scanner produce, and nothing else', () => {
    for (const type of ACCEPTED_CONTENT_TYPES) {
      expect(isAcceptedContentType(type)).toBe(true);
    }
    expect(isAcceptedContentType('application/zip')).toBe(false);
    expect(isAcceptedContentType('text/html')).toBe(false);
    expect(isAcceptedContentType('application/x-msdownload')).toBe(false);
  });

  it('is not fooled by a charset parameter or a capital letter', () => {
    // A browser sends `image/jpeg`; a scanner sends `image/jpeg; charset=binary`.
    // Refusing the second would be refusing a real upload over punctuation.
    expect(isAcceptedContentType('image/jpeg; charset=binary')).toBe(true);
    expect(isAcceptedContentType('IMAGE/PNG')).toBe(true);
    expect(isAcceptedContentType('')).toBe(false);
  });

  it('bounds an upload at something a scan actually is', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('the review sequence', () => {
  it('waits for bytes before anybody reviews anything', () => {
    expect(canTransitionDocument('awaitingUpload', 'submitted')).toBe(true);
    expect(canTransitionDocument('awaitingUpload', 'approved')).toBe(false);
  });

  it('decides a submitted document one way or the other', () => {
    expect(canTransitionDocument('submitted', 'approved')).toBe(true);
    expect(canTransitionDocument('submitted', 'rejected')).toBe(true);
  });

  it('will not re-open a decision', () => {
    // A renewal supersedes rather than re-opens. The row that covered last
    // month's rides has to stay exactly as it was.
    expect(canTransitionDocument('approved', 'rejected')).toBe(false);
    expect(canTransitionDocument('rejected', 'approved')).toBe(false);
    expect(canTransitionDocument('rejected', 'submitted')).toBe(false);
  });

  it('lets an approved document lapse', () => {
    expect(canTransitionDocument('approved', 'expired')).toBe(true);
  });

  it('leaves an expired one alone', () => {
    for (const to of DRIVER_DOCUMENT_STATUSES) {
      expect(canTransitionDocument('expired', to)).toBe(false);
    }
  });

  it('throws on a move that is not allowed', () => {
    expect(() => assertDocumentTransition('rejected', 'approved')).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertDocumentTransition('submitted', 'approved')).not.toThrow();
  });
});

describe('whether a document counts', () => {
  it('counts only once somebody has approved it', () => {
    expect(countsAsValid(doc('driversLicence', { status: 'submitted' }), now)).toBe(
      false,
    );
    expect(countsAsValid(doc('driversLicence', { status: 'approved' }), now)).toBe(
      true,
    );
  });

  it('stops counting the moment it expires, not when a sweep notices', () => {
    // The window between the two is a window in which somebody drives
    // uninsured with the system's blessing.
    const lapsed = doc('vehicleInsurance', {
      expiresAt: new Date(now.getTime() - 1000),
    });
    expect(lapsed.status).toBe('approved');
    expect(countsAsValid(lapsed, now)).toBe(false);
  });

  it('counts one that expires later today', () => {
    expect(
      countsAsValid(
        doc('vehicleInsurance', { expiresAt: new Date(now.getTime() + 1000) }),
        now,
      ),
    ).toBe(true);
  });

  it('counts one with no expiry at all', () => {
    expect(countsAsValid(doc('vehicleRegistration'), now)).toBe(true);
  });
});

describe('whether a driver may be approved', () => {
  it('needs a licence, insurance and a registration', () => {
    const state = complianceOf(fullSet, now);
    expect(state.compliant).toBe(true);
    expect(state.missing).toEqual([]);
  });

  it('does not turn on the background check', () => {
    // A platform check is a database lookup of variable quality and coverage.
    // Treating it as the thing that makes somebody safe would be a claim this
    // product does not make and cannot support — the operator decides who to
    // employ, and the system enforces the legal minimum.
    expect(REQUIRED_FOR_APPROVAL).not.toContain('backgroundCheck');
    expect(complianceOf(fullSet, now).compliant).toBe(true);
  });

  it('names everything that is missing, not just the first', () => {
    // "Nobody can be approved" and "the insurance is missing" need different
    // telephone calls.
    const state = complianceOf([doc('driversLicence')], now);
    expect(state.compliant).toBe(false);
    expect(state.missing).toEqual(['vehicleInsurance', 'vehicleRegistration']);
  });

  it('does not count a document still waiting for review', () => {
    const state = complianceOf(
      REQUIRED_FOR_APPROVAL.map((kind) =>
        doc(kind, { status: kind === 'vehicleInsurance' ? 'submitted' : 'approved' }),
      ),
      now,
    );
    expect(state.compliant).toBe(false);
    expect(state.missing).toEqual(['vehicleInsurance']);
  });

  it('does not count an expired one', () => {
    const state = complianceOf(
      REQUIRED_FOR_APPROVAL.map((kind) =>
        doc(kind, {
          expiresAt: kind === 'vehicleInsurance' ? new Date(now.getTime() - 1) : null,
        }),
      ),
      now,
    );
    expect(state.compliant).toBe(false);
    expect(state.missing).toEqual(['vehicleInsurance']);
  });

  it('warns before something lapses rather than on the morning it does', () => {
    // Enough notice to renew a policy without a gap. Telling somebody on the
    // day takes a driver off the road when their rides are already booked.
    const soon = new Date(
      now.getTime() + (DOCUMENT_EXPIRY_WARNING_DAYS - 1) * 24 * 3600_000,
    );
    const state = complianceOf(
      REQUIRED_FOR_APPROVAL.map((kind) =>
        doc(kind, { expiresAt: kind === 'vehicleInsurance' ? soon : null }),
      ),
      now,
    );

    expect(state.compliant).toBe(true);
    expect(state.expiringSoon).toEqual(['vehicleInsurance']);
  });

  it('does not warn about something with months left', () => {
    const distant = new Date(now.getTime() + 200 * 24 * 3600_000);
    const state = complianceOf(
      REQUIRED_FOR_APPROVAL.map((kind) => doc(kind, { expiresAt: distant })),
      now,
    );
    expect(state.expiringSoon).toEqual([]);
  });

  it('says nothing is held when nothing has been uploaded', () => {
    const state = complianceOf([], now);
    expect(state.compliant).toBe(false);
    expect(state.missing).toEqual([...REQUIRED_FOR_APPROVAL]);
    expect(state.expiringSoon).toEqual([]);
  });

  it('ignores extra documents that are not required', () => {
    const state = complianceOf([...fullSet, doc('backgroundCheck')], now);
    expect(state.compliant).toBe(true);
    expect(state.missing).toEqual([]);
  });
});

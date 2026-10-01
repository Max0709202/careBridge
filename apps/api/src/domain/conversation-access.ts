/**
 * Who may read, write, start and call in a conversation. ADR-0014.
 *
 * Pure: every function takes the facts it needs and returns an answer, so the
 * whole matrix can be asserted exhaustively rather than sampled. The service
 * gathers the facts (`ConversationAuthorizer`) and this file decides.
 *
 * Membership is **derived, not stored.** A thread has no participant list; who
 * is in it is recomputed from the same three edges the rest of the system
 * already trusts — `PatientAccess` for a family, `OrganizationMembership` for
 * a dispatcher, `Driver` (and `Ride.driverId` for a trip) for a driver. That is
 * what makes revoking a grant, offboarding a dispatcher or reassigning a ride
 * take the person out of the conversation too, with nothing else to update.
 */

import { isTerminalRideStatus, type RideStatus } from './ride-status';
import type { DriverStatus } from './driver-status';

export type ConversationKindName =
  | 'dispatchFamily'
  | 'dispatchDriver'
  | 'driverDriver'
  | 'operatorDrivers';

export const CONVERSATION_KINDS: readonly ConversationKindName[] = [
  'dispatchFamily',
  'dispatchDriver',
  'driverDriver',
  'operatorDrivers',
];

/** The capacity someone holds *in one conversation*. */
export type ConversationRole = 'dispatcher' | 'family' | 'driver';

export interface ConversationSubject {
  kind: ConversationKindName;
  organizationId: string;
  patientId: string | null;
  driverId: string | null;
  peerDriverId: string | null;
  rideId: string | null;
}

export interface DriverFacts {
  id: string;
  organizationId: string;
  status: DriverStatus;
  onShift: boolean;
}

/** What the server knows about the person asking. */
export interface ActorFacts {
  userId: string;
  /** Organisations where they hold owner, admin or dispatcher — live only. */
  dispatchesFor: ReadonlySet<string>;
  /** Patients they hold an active `viewProfile` grant on. */
  familyOf: ReadonlySet<string>;
  /** Their driver row, if they have claimed one. */
  driver: DriverFacts | null;
}

export interface RideFacts {
  id: string;
  patientId: string;
  status: RideStatus;
  driverId: string | null;
  /** The operator carrying it: the settled one, else the assigned driver's. */
  operatorId: string | null;
  /** When it reached a terminal status, or null while it is live. */
  endedAt: Date | null;
}

/**
 * How long after a ride ends the family and the driver can still write in its
 * thread. Long enough for "did anyone find her glasses in the back seat"; short
 * enough that a finished trip does not stay an open line to a driver forever.
 * Dispatch can always write — it is their record.
 */
export const RIDE_THREAD_GRACE_MS = 24 * 60 * 60 * 1000;

/** Longest message body, in characters. The database checks it too. */
export const MESSAGE_MAX_LENGTH = 2000;

/** Kinds that can be about one trip. The others are standing channels. */
export function isRideLinkable(kind: ConversationKindName): boolean {
  return kind === 'dispatchFamily' || kind === 'dispatchDriver';
}

/**
 * The one key a subject has, whoever opens it. `driverDriver` is ordered so
 * that A→B and B→A are the same thread.
 */
export function conversationSubjectKey(subject: ConversationSubject): string {
  const parts: string[] = [subject.kind, subject.organizationId];

  switch (subject.kind) {
    case 'dispatchFamily':
      parts.push(subject.patientId ?? '-');
      break;
    case 'dispatchDriver':
      parts.push(subject.driverId ?? '-');
      break;
    case 'driverDriver': {
      const [a, b] = orderedPair(subject.driverId ?? '-', subject.peerDriverId ?? '-');
      parts.push(a, b);
      break;
    }
    case 'operatorDrivers':
      break;
  }

  parts.push(subject.rideId ?? 'general');
  return parts.join(':');
}

export function orderedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

function isWorkingDriver(
  driver: DriverFacts | null,
  organizationId: string,
): driver is DriverFacts {
  return (
    driver !== null &&
    driver.organizationId === organizationId &&
    driver.status === 'approved'
  );
}

/**
 * The capacity `actor` holds in this conversation, or null for none.
 *
 * Dispatcher is checked first: somebody who dispatches for the operator and
 * also happens to be in the patient's family circle is acting for the operator
 * in the operator's thread, and is labelled that way.
 *
 * `ride` must be the ride named by `subject.rideId` (or null for a general
 * thread). A driver reaches a ride's thread only while the ride is theirs —
 * after a reassignment the new driver inherits it and the old one does not.
 */
export function roleIn(
  actor: ActorFacts,
  subject: ConversationSubject,
  ride: RideFacts | null,
): ConversationRole | null {
  if (actor.dispatchesFor.has(subject.organizationId)) return 'dispatcher';

  switch (subject.kind) {
    case 'dispatchFamily':
      return subject.patientId !== null && actor.familyOf.has(subject.patientId)
        ? 'family'
        : null;

    case 'dispatchDriver': {
      if (!isWorkingDriver(actor.driver, subject.organizationId)) return null;
      if (actor.driver.id !== subject.driverId) return null;
      if (subject.rideId !== null && ride?.driverId !== actor.driver.id) return null;
      return 'driver';
    }

    case 'driverDriver': {
      if (!isWorkingDriver(actor.driver, subject.organizationId)) return null;
      const id = actor.driver.id;
      return id === subject.driverId || id === subject.peerDriverId ? 'driver' : null;
    }

    case 'operatorDrivers':
      return isWorkingDriver(actor.driver, subject.organizationId) ? 'driver' : null;
  }
}

export function canRead(role: ConversationRole | null): boolean {
  return role !== null;
}

/**
 * Whether someone who can read may also write.
 *
 * Two exceptions to "reading means writing":
 *
 *   - **Dispatch reads driver-to-driver threads but does not post in them.**
 *     The operator is accountable for what its drivers tell each other about
 *     passengers, so it can see; it is not a party, so it does not speak.
 *   - **A finished ride's thread closes to the family and the driver** after
 *     `RIDE_THREAD_GRACE_MS`. Dispatch keeps writing — follow-ups are theirs.
 */
export function canPost(
  role: ConversationRole | null,
  subject: ConversationSubject,
  ride: RideFacts | null,
  now: Date,
): boolean {
  if (role === null) return false;

  if (role === 'dispatcher') return subject.kind !== 'driverDriver';

  return !isRideThreadClosed(ride, now);
}

export function isRideThreadClosed(ride: RideFacts | null, now: Date): boolean {
  if (ride === null || !isTerminalRideStatus(ride.status)) return false;
  // A terminal ride with no recorded end is treated as ended now: failing open
  // would leave the thread writable forever.
  const endedAt = ride.endedAt ?? now;
  return now.getTime() - endedAt.getTime() > RIDE_THREAD_GRACE_MS;
}

export type StartRefusal =
  /** Not permitted, or something named does not exist — one answer (404). */
  | 'notFound'
  /** The other driver is not working right now. */
  | 'peerOffShift'
  /** The ride has finished and its thread is closed to this person. */
  | 'rideClosed';

export type StartDecision =
  | { ok: true; role: ConversationRole }
  | { ok: false; reason: StartRefusal };

/** Facts only needed to open a new thread, not to read an existing one. */
export interface StartFacts {
  /** For `dispatchFamily`: operators that have carried, or are carrying, this patient. */
  operatorsServingPatient: ReadonlySet<string>;
  /** For `dispatchDriver` / `driverDriver`: the driver(s) named in the subject. */
  subjectDriver: DriverFacts | null;
  peerDriver: DriverFacts | null;
}

/**
 * Whether `actor` may open (find-or-create) a thread about `subject`.
 *
 * Stricter than reading, because opening is the moment a new line of contact
 * comes into existence:
 *
 *   - An operator talks to a family only about a patient it has carried or
 *     is carrying. A dispatcher cannot use this to reach any family on the
 *     platform, and a family cannot open a line to an operator that has never
 *     driven them.
 *   - Ride threads must be consistent: the ride is this patient's, or this
 *     driver's, and it is this operator's.
 *   - A driver may start a thread with a colleague only while that colleague
 *     is on shift. An existing thread stays readable when they go off shift;
 *     what the rule stops is paging somebody on their day off.
 */
export function canStart(
  actor: ActorFacts,
  subject: ConversationSubject,
  ride: RideFacts | null,
  facts: StartFacts,
  now: Date,
): StartDecision {
  const refuse = (reason: StartRefusal): StartDecision => ({ ok: false, reason });

  if (!isShapeValid(subject)) return refuse('notFound');

  if (subject.rideId !== null) {
    if (ride === null || ride.id !== subject.rideId) return refuse('notFound');
    if (ride.operatorId !== subject.organizationId) return refuse('notFound');
    if (subject.kind === 'dispatchFamily' && ride.patientId !== subject.patientId) {
      return refuse('notFound');
    }
    if (subject.kind === 'dispatchDriver' && ride.driverId !== subject.driverId) {
      return refuse('notFound');
    }
  }

  const role = roleIn(actor, subject, ride);
  if (role === null) return refuse('notFound');

  switch (subject.kind) {
    case 'dispatchFamily':
      if (!facts.operatorsServingPatient.has(subject.organizationId))
        return refuse('notFound');
      break;

    case 'dispatchDriver': {
      const driver = facts.subjectDriver;
      if (!driver || driver.id !== subject.driverId) return refuse('notFound');
      if (driver.organizationId !== subject.organizationId) return refuse('notFound');
      if (driver.status === 'offboarded') return refuse('notFound');
      break;
    }

    case 'driverDriver': {
      // Dispatch oversees these threads; it does not open them.
      if (role !== 'driver' || !actor.driver) return refuse('notFound');
      const peerId =
        actor.driver.id === subject.driverId ? subject.peerDriverId : subject.driverId;
      const peer =
        facts.peerDriver?.id === peerId
          ? facts.peerDriver
          : facts.subjectDriver?.id === peerId
            ? facts.subjectDriver
            : null;
      if (!peer || !isWorkingDriver(peer, subject.organizationId))
        return refuse('notFound');
      if (!peer.onShift) return refuse('peerOffShift');
      break;
    }

    case 'operatorDrivers':
      break;
  }

  if (role !== 'dispatcher' && isRideThreadClosed(ride, now))
    return refuse('rideClosed');

  return { ok: true, role };
}

/** The fields each kind needs, and only those. */
function isShapeValid(subject: ConversationSubject): boolean {
  const { kind, patientId, driverId, peerDriverId, rideId } = subject;

  if (rideId !== null && !isRideLinkable(kind)) return false;

  switch (kind) {
    case 'dispatchFamily':
      return patientId !== null && driverId === null && peerDriverId === null;
    case 'dispatchDriver':
      return driverId !== null && patientId === null && peerDriverId === null;
    case 'driverDriver':
      return (
        driverId !== null &&
        peerDriverId !== null &&
        driverId !== peerDriverId &&
        patientId === null
      );
    case 'operatorDrivers':
      return patientId === null && driverId === null && peerDriverId === null;
  }
}

// ─── calls ───────────────────────────────────────────────────────────────────

export type CallPartyKindName = 'patient' | 'familyMember' | 'driver' | 'dispatch';

/**
 * The ride statuses in which a family and the driver may phone each other:
 * from the driver accepting to the car reaching the destination. Before that
 * there is no driver to call; after it, the relay closes, because a relay
 * number that keeps connecting a driver to a patient's family after the trip
 * is exactly the contact the relay exists to prevent.
 */
export const RIDE_CALL_WINDOW: readonly RideStatus[] = [
  'driverAccepted',
  'driverEnRoute',
  'driverArrived',
  'passengerOnboard',
  'inProgress',
  'arrivedAtDestination',
];

/**
 * Whether someone in `role` may place a relay call to a `callee`.
 *
 * The pairs:
 *
 *   dispatcher → patient, family member, driver
 *   family     → dispatch; the ride's driver, inside the ride window
 *   driver     → dispatch; the ride's patient, inside the ride window
 *
 * Nobody else. Drivers do not phone each other through the relay — that is
 * chat, and a relay line between two employees of one company is the
 * company's phone system, not ours.
 */
export function canCall(
  role: ConversationRole,
  callee: CallPartyKindName,
  ride: RideFacts | null,
): boolean {
  switch (role) {
    case 'dispatcher':
      return callee === 'patient' || callee === 'familyMember' || callee === 'driver';
    case 'family':
      if (callee === 'dispatch') return true;
      return callee === 'driver' && isInCallWindow(ride);
    case 'driver':
      if (callee === 'dispatch') return true;
      return callee === 'patient' && isInCallWindow(ride);
  }
}

function isInCallWindow(ride: RideFacts | null): boolean {
  return (
    ride !== null && ride.driverId !== null && RIDE_CALL_WINDOW.includes(ride.status)
  );
}

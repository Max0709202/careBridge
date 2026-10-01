import { ConversationKind } from '@prisma/client';

import {
  CONVERSATION_KINDS,
  RIDE_CALL_WINDOW,
  RIDE_THREAD_GRACE_MS,
  canCall,
  canPost,
  canRead,
  canStart,
  conversationSubjectKey,
  isRideLinkable,
  roleIn,
  type ActorFacts,
  type CallPartyKindName,
  type ConversationRole,
  type ConversationSubject,
  type DriverFacts,
  type RideFacts,
  type StartFacts,
} from './conversation-access';
import { RIDE_STATUSES, isTerminalRideStatus, type RideStatus } from './ride-status';
import { DRIVER_STATUSES } from './driver-status';

const ORG = 'org-meridian';
const OTHER_ORG = 'org-elsewhere';
const PATIENT = 'patient-eleanor';
const NOW = new Date('2026-10-01T12:00:00Z');

const driver = (id: string, over: Partial<DriverFacts> = {}): DriverFacts => ({
  id,
  organizationId: ORG,
  status: 'approved',
  onShift: true,
  ...over,
});

const actor = (over: Partial<ActorFacts> = {}): ActorFacts => ({
  userId: 'user',
  dispatchesFor: new Set(),
  familyOf: new Set(),
  driver: null,
  ...over,
});

const dispatcher = actor({ userId: 'dispatch', dispatchesFor: new Set([ORG]) });
const otherDispatcher = actor({ userId: 'other', dispatchesFor: new Set([OTHER_ORG]) });
const family = actor({ userId: 'sarah', familyOf: new Set([PATIENT]) });
const marcus = actor({ userId: 'marcus', driver: driver('d-marcus') });
const priya = actor({ userId: 'priya', driver: driver('d-priya') });
const stranger = actor({ userId: 'stranger' });

const subject = (over: Partial<ConversationSubject>): ConversationSubject => ({
  kind: 'dispatchFamily',
  organizationId: ORG,
  patientId: null,
  driverId: null,
  peerDriverId: null,
  rideId: null,
  ...over,
});

const familyThread = subject({ kind: 'dispatchFamily', patientId: PATIENT });
const driverThread = subject({ kind: 'dispatchDriver', driverId: 'd-marcus' });
const pairThread = subject({
  kind: 'driverDriver',
  driverId: 'd-marcus',
  peerDriverId: 'd-priya',
});
const teamThread = subject({ kind: 'operatorDrivers' });

const ride = (over: Partial<RideFacts> = {}): RideFacts => ({
  id: 'ride-1',
  patientId: PATIENT,
  status: 'driverEnRoute',
  driverId: 'd-marcus',
  operatorId: ORG,
  endedAt: null,
  ...over,
});

const startFacts = (over: Partial<StartFacts> = {}): StartFacts => ({
  operatorsServingPatient: new Set([ORG]),
  subjectDriver: driver('d-marcus'),
  peerDriver: driver('d-priya'),
  ...over,
});

describe('conversation kinds', () => {
  it('match the schema enum exactly', () => {
    // A kind added to the schema and not here would be a thread nobody can
    // read, and this file's switch statements would not notice.
    expect([...CONVERSATION_KINDS].sort()).toEqual(
      Object.values(ConversationKind).sort(),
    );
  });

  it('only dispatch threads can be about one ride', () => {
    expect(CONVERSATION_KINDS.filter(isRideLinkable)).toEqual([
      'dispatchFamily',
      'dispatchDriver',
    ]);
  });
});

describe('subject keys', () => {
  it('are the same whichever driver opens a pair thread', () => {
    const ab = conversationSubjectKey(pairThread);
    const ba = conversationSubjectKey({
      ...pairThread,
      driverId: 'd-priya',
      peerDriverId: 'd-marcus',
    });
    expect(ab).toBe(ba);
  });

  it('distinguish a ride thread from the general thread for the same people', () => {
    expect(conversationSubjectKey(familyThread)).not.toBe(
      conversationSubjectKey({ ...familyThread, rideId: 'ride-1' }),
    );
  });

  it('distinguish operators', () => {
    expect(conversationSubjectKey(familyThread)).not.toBe(
      conversationSubjectKey({ ...familyThread, organizationId: OTHER_ORG }),
    );
  });
});

describe('roleIn — who is in a thread', () => {
  const cases: Array<
    [string, ActorFacts, ConversationSubject, ConversationRole | null]
  > = [
    ['dispatch, family thread', dispatcher, familyThread, 'dispatcher'],
    ['family, family thread', family, familyThread, 'family'],
    ['driver, family thread', marcus, familyThread, null],
    ['stranger, family thread', stranger, familyThread, null],
    ['another operator, family thread', otherDispatcher, familyThread, null],

    ['dispatch, driver thread', dispatcher, driverThread, 'dispatcher'],
    ['that driver, driver thread', marcus, driverThread, 'driver'],
    ['another driver, driver thread', priya, driverThread, null],
    ['family, driver thread', family, driverThread, null],

    ['dispatch, pair thread', dispatcher, pairThread, 'dispatcher'],
    ['one side, pair thread', marcus, pairThread, 'driver'],
    ['other side, pair thread', priya, pairThread, 'driver'],
    [
      'a third driver, pair thread',
      actor({ driver: driver('d-third') }),
      pairThread,
      null,
    ],

    ['dispatch, team channel', dispatcher, teamThread, 'dispatcher'],
    ['driver, team channel', marcus, teamThread, 'driver'],
    [
      'driver at another operator, team channel',
      actor({ driver: driver('d-x', { organizationId: OTHER_ORG }) }),
      teamThread,
      null,
    ],
    ['family, team channel', family, teamThread, null],
  ];

  it.each(cases)('%s', (_label, who, about, expected) => {
    expect(roleIn(who, about, null)).toBe(expected);
  });

  it('shuts out a driver who is no longer approved, whatever the kind', () => {
    for (const status of DRIVER_STATUSES.filter((s) => s !== 'approved')) {
      const suspended = actor({ driver: driver('d-marcus', { status }) });
      for (const about of [driverThread, pairThread, teamThread]) {
        expect(roleIn(suspended, about, null)).toBeNull();
      }
    }
  });

  it('gives a ride thread to the driver the ride is assigned to, and not to the one it was taken from', () => {
    const rideThread = { ...driverThread, rideId: 'ride-1' };
    expect(roleIn(marcus, rideThread, ride())).toBe('driver');

    // Reassigned to Priya: Marcus's old thread about this ride is gone.
    expect(roleIn(marcus, rideThread, ride({ driverId: 'd-priya' }))).toBeNull();
  });

  it('prefers dispatcher when someone is both dispatcher and family', () => {
    const both = actor({ dispatchesFor: new Set([ORG]), familyOf: new Set([PATIENT]) });
    expect(roleIn(both, familyThread, null)).toBe('dispatcher');
  });
});

describe('canPost', () => {
  it('requires being in the thread', () => {
    expect(canPost(null, familyThread, null, NOW)).toBe(false);
    expect(canRead(null)).toBe(false);
  });

  it('lets dispatch read driver-to-driver threads but not post in them', () => {
    expect(canRead('dispatcher')).toBe(true);
    expect(canPost('dispatcher', pairThread, null, NOW)).toBe(false);
    expect(canPost('driver', pairThread, null, NOW)).toBe(true);
  });

  describe('on a ride thread', () => {
    const thread = { ...familyThread, rideId: 'ride-1' };

    it.each(RIDE_STATUSES.map((s) => [s]))(
      'stays open to everyone while %s is live, or just ended',
      (status) => {
        const r = ride({ status, endedAt: isTerminalRideStatus(status) ? NOW : null });
        for (const role of ['dispatcher', 'family', 'driver'] as ConversationRole[]) {
          expect(canPost(role, thread, r, NOW)).toBe(true);
        }
      },
    );

    it('closes to the family and the driver after the grace period, and never to dispatch', () => {
      const ended = new Date(NOW.getTime() - RIDE_THREAD_GRACE_MS - 1);
      for (const status of RIDE_STATUSES.filter(isTerminalRideStatus)) {
        const r = ride({ status, endedAt: ended });
        expect(canPost('family', thread, r, NOW)).toBe(false);
        expect(canPost('driver', thread, r, NOW)).toBe(false);
        expect(canPost('dispatcher', thread, r, NOW)).toBe(true);
      }
    });

    it('is still open one millisecond inside the grace period', () => {
      const r = ride({
        status: 'completed',
        endedAt: new Date(NOW.getTime() - RIDE_THREAD_GRACE_MS),
      });
      expect(canPost('family', thread, r, NOW)).toBe(true);
    });
  });
});

describe('canStart — opening a line', () => {
  it('lets dispatch open a thread with the family of a patient it has carried', () => {
    expect(canStart(dispatcher, familyThread, null, startFacts(), NOW)).toEqual({
      ok: true,
      role: 'dispatcher',
    });
  });

  it('does not let dispatch reach a family it has never carried', () => {
    const facts = startFacts({ operatorsServingPatient: new Set([OTHER_ORG]) });
    expect(canStart(dispatcher, familyThread, null, facts, NOW)).toEqual({
      ok: false,
      reason: 'notFound',
    });
  });

  it('does not let a family open a line to an operator that has never driven them', () => {
    const facts = startFacts({ operatorsServingPatient: new Set() });
    expect(canStart(family, familyThread, null, facts, NOW).ok).toBe(false);
    expect(canStart(family, familyThread, null, startFacts(), NOW).ok).toBe(true);
  });

  it('refuses a ride that belongs to another patient, driver or operator', () => {
    const facts = startFacts();
    const onRide = { ...familyThread, rideId: 'ride-1' };
    expect(
      canStart(dispatcher, onRide, ride({ patientId: 'someone-else' }), facts, NOW).ok,
    ).toBe(false);
    expect(
      canStart(dispatcher, onRide, ride({ operatorId: OTHER_ORG }), facts, NOW).ok,
    ).toBe(false);
    expect(canStart(dispatcher, onRide, null, facts, NOW).ok).toBe(false);

    const driverRide = { ...driverThread, rideId: 'ride-1' };
    expect(
      canStart(dispatcher, driverRide, ride({ driverId: 'd-priya' }), facts, NOW).ok,
    ).toBe(false);
    expect(canStart(dispatcher, driverRide, ride(), facts, NOW).ok).toBe(true);
  });

  it('refuses ride links on standing channels', () => {
    expect(
      canStart(marcus, { ...teamThread, rideId: 'ride-1' }, ride(), startFacts(), NOW)
        .ok,
    ).toBe(false);
    expect(
      canStart(marcus, { ...pairThread, rideId: 'ride-1' }, ride(), startFacts(), NOW)
        .ok,
    ).toBe(false);
  });

  it('refuses a malformed subject', () => {
    expect(
      canStart(dispatcher, subject({ kind: 'dispatchFamily' }), null, startFacts(), NOW)
        .ok,
    ).toBe(false);
    expect(
      canStart(
        marcus,
        { ...pairThread, peerDriverId: 'd-marcus' },
        null,
        startFacts(),
        NOW,
      ).ok,
    ).toBe(false);
  });

  it('refuses a dispatch thread with an offboarded driver or one at another operator', () => {
    expect(
      canStart(
        dispatcher,
        driverThread,
        null,
        startFacts({ subjectDriver: driver('d-marcus', { status: 'offboarded' }) }),
        NOW,
      ).ok,
    ).toBe(false);
    expect(
      canStart(
        dispatcher,
        driverThread,
        null,
        startFacts({
          subjectDriver: driver('d-marcus', { organizationId: OTHER_ORG }),
        }),
        NOW,
      ).ok,
    ).toBe(false);
  });

  describe('driver to driver', () => {
    it('opens with an on-shift colleague, from either side', () => {
      expect(canStart(marcus, pairThread, null, startFacts(), NOW).ok).toBe(true);
      expect(canStart(priya, pairThread, null, startFacts(), NOW).ok).toBe(true);
    });

    it('says so when the colleague is off shift', () => {
      const facts = startFacts({ peerDriver: driver('d-priya', { onShift: false }) });
      expect(canStart(marcus, pairThread, null, facts, NOW)).toEqual({
        ok: false,
        reason: 'peerOffShift',
      });
    });

    it('does not care whether the starter is on shift', () => {
      const offShiftMarcus = actor({ driver: driver('d-marcus', { onShift: false }) });
      expect(canStart(offShiftMarcus, pairThread, null, startFacts(), NOW).ok).toBe(
        true,
      );
    });

    it('refuses a colleague who is not approved', () => {
      const facts = startFacts({
        peerDriver: driver('d-priya', { status: 'suspended' }),
      });
      expect(canStart(marcus, pairThread, null, facts, NOW).ok).toBe(false);
    });

    it('is not something dispatch opens', () => {
      expect(canStart(dispatcher, pairThread, null, startFacts(), NOW).ok).toBe(false);
    });
  });

  it('refuses a family opening a ride thread after it has closed, but not dispatch', () => {
    const onRide = { ...familyThread, rideId: 'ride-1' };
    const closed = ride({
      status: 'completed',
      endedAt: new Date(NOW.getTime() - RIDE_THREAD_GRACE_MS - 1),
    });
    expect(canStart(family, onRide, closed, startFacts(), NOW)).toEqual({
      ok: false,
      reason: 'rideClosed',
    });
    expect(canStart(dispatcher, onRide, closed, startFacts(), NOW).ok).toBe(true);
  });
});

describe('canCall — the relay pairs', () => {
  const callees: CallPartyKindName[] = [
    'patient',
    'familyMember',
    'driver',
    'dispatch',
  ];
  const live = ride({ status: 'driverEnRoute' });

  const allowed = (role: ConversationRole, r: RideFacts | null): CallPartyKindName[] =>
    callees.filter((callee) => canCall(role, callee, r));

  it('dispatch calls patients, families and drivers, with or without a ride', () => {
    expect(allowed('dispatcher', null)).toEqual(['patient', 'familyMember', 'driver']);
    expect(allowed('dispatcher', live)).toEqual(['patient', 'familyMember', 'driver']);
  });

  it('a family calls dispatch always, and the driver only during the ride', () => {
    expect(allowed('family', null)).toEqual(['dispatch']);
    expect(allowed('family', live)).toEqual(['driver', 'dispatch']);
  });

  it('a driver calls dispatch always, and the patient only during the ride', () => {
    expect(allowed('driver', null)).toEqual(['dispatch']);
    expect(allowed('driver', live)).toEqual(['patient', 'dispatch']);
  });

  it.each(RIDE_STATUSES.map((s) => [s]))(
    'family↔driver window at %s',
    (status: RideStatus) => {
      const inWindow = RIDE_CALL_WINDOW.includes(status);
      expect(canCall('family', 'driver', ride({ status }))).toBe(inWindow);
      expect(canCall('driver', 'patient', ride({ status }))).toBe(inWindow);
    },
  );

  it('closes the family↔driver line when no driver is assigned', () => {
    expect(canCall('family', 'driver', ride({ driverId: null }))).toBe(false);
  });
});

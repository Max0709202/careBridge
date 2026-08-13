import { NotificationKind } from '@prisma/client';

import {
  ALL_CHANNELS,
  NOTIFICATION_POLICY,
  preferenceMatrix,
  resolveChannels,
  type NotificationKindName,
} from './notification-policy';

describe('notification policy coverage', () => {
  it('has an entry for every NotificationKind in the schema', () => {
    // A kind added to the enum without a policy here would produce a
    // notification that silently goes nowhere. This is the test that turns
    // that into a build failure.
    const declared = Object.keys(NOTIFICATION_POLICY).sort();
    const schema = Object.values(NotificationKind).sort();

    expect(declared).toEqual(schema);
  });

  it('declares no kind the schema does not have', () => {
    for (const kind of Object.keys(NOTIFICATION_POLICY)) {
      expect(Object.values(NotificationKind)).toContain(kind);
    }
  });
});

describe('the in-app invariant', () => {
  it('never lets in-app be switched off, for any kind', () => {
    // The centre inside the app is the record of what happened. A user who
    // could switch it off would have a timeline that lies by omission — and
    // the timeline is what no-show and late-pickup disputes are resolved with.
    for (const kind of Object.keys(NOTIFICATION_POLICY) as NotificationKindName[]) {
      expect(NOTIFICATION_POLICY[kind].inApp.configurable).toBe(false);
      expect(NOTIFICATION_POLICY[kind].inApp.defaultEnabled).toBe(true);

      expect(
        resolveChannels(kind, { inApp: false, email: false, push: false }),
      ).toContain('inApp');
    }
  });
});

describe('resolving channels', () => {
  it('uses the defaults when the user has never touched settings', () => {
    expect(resolveChannels('driverAssigned')).toEqual(['inApp', 'email', 'push']);
    expect(resolveChannels('rideRequested')).toEqual(['inApp']);
  });

  it('honours an override on a configurable channel', () => {
    expect(resolveChannels('driverAssigned', { email: false })).toEqual([
      'inApp',
      'push',
    ]);
    expect(resolveChannels('rideRequested', { push: true })).toEqual(['inApp', 'push']);
  });

  it('ignores a stored override on a channel that is not configurable', () => {
    // Such a row can arrive from an old client or a support script. The
    // invariant must not depend on every writer having been careful.
    expect(resolveChannels('rideCompleted', { inApp: false })).toContain('inApp');
  });
});

describe('the settings matrix', () => {
  it('offers one row per kind per channel', () => {
    expect(preferenceMatrix()).toHaveLength(
      Object.keys(NOTIFICATION_POLICY).length * ALL_CHANNELS.length,
    );
  });

  it('keeps the live-ride sequence off email', () => {
    // Six emails during one journey is how a person turns email off entirely,
    // and then misses the cancellation.
    for (const kind of [
      'driverEnRoute',
      'driverArrivingSoon',
      'driverArrived',
      'patientPickedUp',
      'patientArrived',
    ] as NotificationKindName[]) {
      expect(NOTIFICATION_POLICY[kind].email.defaultEnabled).toBe(false);
      expect(NOTIFICATION_POLICY[kind].push.defaultEnabled).toBe(true);
    }
  });
});

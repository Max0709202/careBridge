import {
  RETURN_WAIT_CONCERN_MINUTES,
  assertCanDispatchReturn,
  canCheckIn,
  canDispatchReturn,
  returnIsOverdue,
  stageOf,
  waitingMinutes,
  type VisitState,
} from './clinic-visit';
import { ValidationError } from '../common/errors';

/**
 * What a clinic may say about a visit.
 *
 * The rule worth protecting is that **checking in is not the ride
 * completing**. A completed ride says a car reached an address; a check-in
 * says somebody inside the building saw the patient. The gap between the two
 * is an eighty-year-old at the wrong entrance of a hospital, which is the case
 * this whole product exists for.
 */

const now = new Date('2026-06-15T14:00:00Z');

function visit(overrides: Partial<VisitState> = {}): VisitState {
  return {
    checkedInAt: null,
    readyForReturnAt: null,
    outboundStatus: 'completed',
    returnStatus: 'draft',
    ...overrides,
  };
}

describe('checking in', () => {
  it('is allowed for somebody who has not been checked in', () => {
    expect(canCheckIn(visit())).toBe(true);
  });

  it('is not inferred from the ride completing', () => {
    // The whole point. A car reached an address; that is not the same as a
    // person walking through a door, and conflating them loses the failure
    // this product is for.
    const arrived = visit({ outboundStatus: 'completed' });
    expect(stageOf(arrived)).toBe('expected');
  });

  it('is allowed for somebody the platform did not carry', () => {
    // A patient whose daughter drove them still walks through the door. A
    // portal that could only check in its own passengers would be wrong about
    // half the waiting room.
    expect(canCheckIn(visit({ outboundStatus: null, returnStatus: null }))).toBe(true);
  });

  it('cannot be done twice', () => {
    expect(canCheckIn(visit({ checkedInAt: now }))).toBe(false);
  });
});

describe('sending a car home', () => {
  it('refuses for somebody who never arrived', () => {
    // A wasted journey and a confused driver.
    const check = canDispatchReturn(visit());
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/arrived first/i);
  });

  it('allows it once the patient is checked in', () => {
    expect(canDispatchReturn(visit({ checkedInAt: now })).ok).toBe(true);
  });

  it('says so plainly when no return was booked', () => {
    // Written for somebody at a reception desk, not for a log.
    const check = canDispatchReturn(visit({ checkedInAt: now, returnStatus: null }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/family can add one/i);
  });

  it('refuses a second car when one is already coming', () => {
    // A second charge and a second vehicle at the kerb.
    const check = canDispatchReturn(
      visit({ checkedInAt: now, returnStatus: 'driverEnRoute' }),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/already on the way/i);
  });

  it('refuses when the family cancelled the return', () => {
    const check = canDispatchReturn(
      visit({ checkedInAt: now, returnStatus: 'canceled' }),
    );
    expect(check.ok).toBe(false);
  });

  it('throws with the same words the check reports', () => {
    expect(() => assertCanDispatchReturn(visit())).toThrow(ValidationError);
    expect(() => assertCanDispatchReturn(visit({ checkedInAt: now }))).not.toThrow();
  });
});

describe('the stage a visit is at', () => {
  it('walks from expected to finished', () => {
    expect(stageOf(visit())).toBe('expected');
    expect(stageOf(visit({ checkedInAt: now }))).toBe('checkedIn');
    expect(stageOf(visit({ checkedInAt: now, readyForReturnAt: now }))).toBe(
      'readyForReturn',
    );
    expect(
      stageOf(
        visit({
          checkedInAt: now,
          readyForReturnAt: now,
          returnStatus: 'driverEnRoute',
        }),
      ),
    ).toBe('returning');
    expect(stageOf(visit({ returnStatus: 'completed' }))).toBe('finished');
  });

  it('notices a car the family sent without the clinic', () => {
    // The family can dispatch the return themselves. A portal that only
    // believed its own button would show a patient as still waiting while a
    // car was outside.
    expect(stageOf(visit({ checkedInAt: now, returnStatus: 'driverAccepted' }))).toBe(
      'returning',
    );
  });
});

describe('how long somebody has been waiting', () => {
  it('is nothing until the clinic says they are ready', () => {
    expect(waitingMinutes(visit({ checkedInAt: now }), now)).toBeNull();
  });

  it('counts from the moment the button was pressed', () => {
    const ready = new Date(now.getTime() - 12 * 60_000);
    expect(
      waitingMinutes(visit({ checkedInAt: ready, readyForReturnAt: ready }), now),
    ).toBe(12);
  });

  it('stops counting once the patient is in the car', () => {
    const ready = new Date(now.getTime() - 40 * 60_000);
    expect(
      waitingMinutes(
        visit({
          checkedInAt: ready,
          readyForReturnAt: ready,
          returnStatus: 'passengerOnboard',
        }),
        now,
      ),
    ).toBeNull();
  });

  it('flags a wait that has stopped being ordinary', () => {
    // The person who pressed the button is standing next to somebody in a coat
    // by the door. "It has been forty minutes" is the fact that makes them
    // telephone.
    const ready = new Date(now.getTime() - RETURN_WAIT_CONCERN_MINUTES * 60_000);
    expect(
      returnIsOverdue(visit({ checkedInAt: ready, readyForReturnAt: ready }), now),
    ).toBe(true);
  });

  it('does not flag a busy afternoon', () => {
    const ready = new Date(now.getTime() - 5 * 60_000);
    expect(
      returnIsOverdue(visit({ checkedInAt: ready, readyForReturnAt: ready }), now),
    ).toBe(false);
  });

  it('does not flag a visit nobody has finished yet', () => {
    expect(returnIsOverdue(visit({ checkedInAt: now }), now)).toBe(false);
  });
});

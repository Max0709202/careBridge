import {
  DRIVER_STATUSES,
  assertDriverTransition,
  canTransitionDriver,
  isAssignable,
  isTerminalDriverStatus,
  occupiesSeat,
  type DriverStatus,
} from './driver-status';
import { InvalidTransitionError } from '../common/errors';

describe('driver lifecycle', () => {
  it('walks onboarding in order', () => {
    expect(canTransitionDriver('invited', 'pendingApproval')).toBe(true);
    expect(canTransitionDriver('pendingApproval', 'approved')).toBe(true);
  });

  it('refuses to approve somebody who has submitted nothing', () => {
    // An operator that can approve an empty file has an onboarding control
    // that does nothing.
    expect(canTransitionDriver('invited', 'approved')).toBe(false);
  });

  it('suspends and reinstates without losing the record', () => {
    expect(canTransitionDriver('approved', 'suspended')).toBe(true);
    expect(canTransitionDriver('suspended', 'approved')).toBe(true);
  });

  it('never brings an offboarded driver back', () => {
    // The row stays so a completed ride from March still names its driver;
    // returning is a new record, not a resurrection.
    for (const to of DRIVER_STATUSES) {
      expect(canTransitionDriver('offboarded', to)).toBe(false);
    }
    expect(isTerminalDriverStatus('offboarded')).toBe(true);
    expect(isTerminalDriverStatus('approved')).toBe(false);
  });

  it('refuses every transition the table does not name', () => {
    expect(canTransitionDriver('approved', 'pendingApproval')).toBe(false);
    expect(canTransitionDriver('suspended', 'pendingApproval')).toBe(false);
    expect(canTransitionDriver('invited', 'suspended')).toBe(false);
  });

  it('throws with both ends recorded, and tells the user neither', () => {
    expect(() => assertDriverTransition('offboarded', 'approved')).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertDriverTransition('pendingApproval', 'approved')).not.toThrow();

    try {
      assertDriverTransition('invited', 'approved');
      throw new Error('unreachable');
    } catch (error) {
      const failure = error as InvalidTransitionError;
      expect(failure.from).toBe('invited');
      expect(failure.to).toBe('approved');
      expect(failure.message).not.toContain('invited');
    }
  });
});

describe('what a status means for money and for dispatch', () => {
  it('bills for approved drivers and no others', () => {
    // The single definition. A second boolean somebody has to keep in step
    // ends with an operator billed for drivers they offboarded in March.
    const billed = DRIVER_STATUSES.filter(occupiesSeat);
    expect(billed).toEqual<DriverStatus[]>(['approved']);
  });

  it('lets exactly the billed drivers be assigned', () => {
    for (const status of DRIVER_STATUSES) {
      expect(isAssignable(status)).toBe(occupiesSeat(status));
    }
  });
});

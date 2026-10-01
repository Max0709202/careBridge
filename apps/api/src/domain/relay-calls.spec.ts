import { CallStatus } from '@prisma/client';

import {
  CALL_STATUSES,
  callSummaryLine,
  canAdvanceCall,
  isMissedByCallee,
  isTerminalCallStatus,
} from './relay-calls';

describe('relay call states', () => {
  it('match the schema enum', () => {
    expect([...CALL_STATUSES].sort()).toEqual(Object.values(CallStatus).sort());
  });

  it('only move forward', () => {
    expect(canAdvanceCall('initiating', 'ringingCaller')).toBe(true);
    expect(canAdvanceCall('ringingCaller', 'ringingCallee')).toBe(true);
    expect(canAdvanceCall('ringingCallee', 'inProgress')).toBe(true);
    expect(canAdvanceCall('inProgress', 'completed')).toBe(true);

    // Out-of-order and duplicate callbacks.
    expect(canAdvanceCall('inProgress', 'ringingCallee')).toBe(false);
    expect(canAdvanceCall('ringingCallee', 'ringingCallee')).toBe(false);
  });

  it('never reopen a finished call', () => {
    for (const from of CALL_STATUSES.filter(isTerminalCallStatus)) {
      for (const to of CALL_STATUSES) expect(canAdvanceCall(from, to)).toBe(false);
    }
  });

  it('can end from any live state', () => {
    for (const from of CALL_STATUSES.filter((s) => !isTerminalCallStatus(s))) {
      expect(canAdvanceCall(from, 'failed')).toBe(true);
    }
  });

  it('counts a call as missed only if the callee phone actually rang', () => {
    expect(isMissedByCallee(true, 'noAnswer')).toBe(true);
    expect(isMissedByCallee(true, 'busy')).toBe(true);
    expect(isMissedByCallee(false, 'noAnswer')).toBe(false);
    expect(isMissedByCallee(true, 'completed')).toBe(false);
  });

  it('summarises the outcome without saying who or what', () => {
    expect(callSummaryLine('completed', true, 185)).toBe('Call · 3 min');
    expect(callSummaryLine('completed', true, 5)).toBe('Call · 1 min');
    expect(callSummaryLine('noAnswer', true, null)).toBe('Missed call');
    expect(callSummaryLine('noAnswer', false, null)).toBeNull();
    expect(callSummaryLine('failed', false, null)).toBe('Call could not be connected');
    expect(callSummaryLine('canceled', false, null)).toBeNull();
  });
});

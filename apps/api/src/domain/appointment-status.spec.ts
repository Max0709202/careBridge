import {
  appointmentStatusForRide,
  assertAppointmentTransition,
  canTransitionAppointment,
  isTerminalAppointmentStatus,
  type AppointmentStatus,
} from './appointment-status';
import { RIDE_STATUSES, type RideStatus } from './ride-status';
import { InvalidTransitionError } from '../common/errors';

const ALL: AppointmentStatus[] = [
  'draft',
  'scheduled',
  'confirmed',
  'patientPreparing',
  'transportationScheduled',
  'patientEnRoute',
  'patientArrived',
  'completed',
  'canceled',
  'missed',
];

describe('appointment state machine', () => {
  it('runs the path a coordinated visit actually takes', () => {
    const journey: AppointmentStatus[] = [
      'draft',
      'scheduled',
      'transportationScheduled',
      'patientPreparing',
      'patientEnRoute',
      'patientArrived',
      'completed',
    ];

    for (let i = 0; i < journey.length - 1; i += 1) {
      expect(canTransitionAppointment(journey[i]!, journey[i + 1]!)).toBe(true);
    }
  });

  it('treats terminal states as final', () => {
    for (const status of ['completed', 'canceled', 'missed'] as AppointmentStatus[]) {
      expect(isTerminalAppointmentStatus(status)).toBe(true);
      for (const to of ALL) {
        expect(canTransitionAppointment(status, to)).toBe(false);
      }
    }
  });

  it('allows cancellation while there is still something to cancel', () => {
    for (const status of ALL.filter((s) => !isTerminalAppointmentStatus(s))) {
      expect(canTransitionAppointment(status, 'canceled')).toBe(true);
    }
  });

  it('cannot mark an arrived patient as missed', () => {
    // They are demonstrably at the clinic. "Missed" after arrival would be a
    // contradiction the timeline could never explain.
    expect(canTransitionAppointment('patientArrived', 'missed')).toBe(false);
    expect(canTransitionAppointment('patientArrived', 'completed')).toBe(true);
  });

  it('never allows a status to transition to itself', () => {
    for (const status of ALL) {
      expect(canTransitionAppointment(status, status)).toBe(false);
    }
  });

  it('throws on an illegal transition', () => {
    expect(() => assertAppointmentTransition('draft', 'completed')).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertAppointmentTransition('scheduled', 'confirmed')).not.toThrow();
  });

  describe('ride progress driving appointment progress', () => {
    it('maps the four ride states that say something about the visit', () => {
      expect(appointmentStatusForRide('assigned')).toBe('transportationScheduled');
      expect(appointmentStatusForRide('driverArrived')).toBe('patientPreparing');
      expect(appointmentStatusForRide('passengerOnboard')).toBe('patientEnRoute');
      expect(appointmentStatusForRide('arrivedAtDestination')).toBe('patientArrived');
    });

    it('says nothing for ride states that imply nothing', () => {
      const silent = RIDE_STATUSES.filter(
        (s) =>
          ![
            'assigned',
            'driverArrived',
            'passengerOnboard',
            'arrivedAtDestination',
          ].includes(s),
      );
      for (const status of silent) {
        expect(appointmentStatusForRide(status)).toBeNull();
      }
    });

    it('refuses every transition out of a status it does not recognise', () => {
      // Not reachable through the type system, but reachable through the
      // database: a row written by a newer deploy and read by an older one
      // carries a status this build has never heard of. The lookup falls
      // through to "no", so an unknown status is inert rather than unguarded.
      const unknown = 'rescheduledTwice' as AppointmentStatus;
      expect(canTransitionAppointment(unknown, 'canceled')).toBe(false);
      expect(() => assertAppointmentTransition(unknown, 'canceled')).toThrow(
        InvalidTransitionError,
      );
    });

    it('only ever implies a status the machine could actually reach', () => {
      // A mapping that produced an unreachable status would make every ride
      // transition throw at exactly the wrong moment.
      for (const rideStatus of RIDE_STATUSES as RideStatus[]) {
        const implied = appointmentStatusForRide(rideStatus);
        if (!implied) continue;
        const reachable = ALL.some((from) => canTransitionAppointment(from, implied));
        expect(reachable).toBe(true);
      }
    });
  });
});

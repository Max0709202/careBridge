import 'package:carebridge_family/core/failures.dart';
import 'package:carebridge_family/domain/appointment_status.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('appointment state machine', () {
    test('walks a normal appointment through to completion', () {
      const path = [
        AppointmentStatus.draft,
        AppointmentStatus.scheduled,
        AppointmentStatus.transportationScheduled,
        AppointmentStatus.patientPreparing,
        AppointmentStatus.patientEnRoute,
        AppointmentStatus.patientArrived,
        AppointmentStatus.completed,
      ];

      for (var i = 0; i < path.length - 1; i++) {
        expect(
          canTransitionAppointment(path[i], path[i + 1]),
          isTrue,
          reason: '${path[i].name} -> ${path[i + 1].name}',
        );
      }
    });

    test('terminal states are final', () {
      for (final terminal in [
        AppointmentStatus.completed,
        AppointmentStatus.canceled,
        AppointmentStatus.missed,
      ]) {
        expect(terminal.isTerminal, isTrue);
        expect(terminal.isUpcoming, isFalse);
        expect(allowedAppointmentTransitions(terminal), isEmpty);
      }
    });

    test('an appointment cannot be marked arrived before it is scheduled', () {
      expect(
        canTransitionAppointment(
          AppointmentStatus.draft,
          AppointmentStatus.patientArrived,
        ),
        isFalse,
      );
    });

    test('an arrived patient cannot be marked missed', () {
      expect(
        canTransitionAppointment(
          AppointmentStatus.patientArrived,
          AppointmentStatus.missed,
        ),
        isFalse,
      );
    });

    test('assertAppointmentTransition throws on an illegal move', () {
      expect(
        () => assertAppointmentTransition(
          AppointmentStatus.completed,
          AppointmentStatus.scheduled,
        ),
        throwsA(isA<InvalidTransitionFailure>()),
      );
    });

    group('ride progress drives appointment progress', () {
      test('maps the transitions a family should not have to track twice', () {
        expect(
          appointmentStatusForRide('assigned'),
          AppointmentStatus.transportationScheduled,
        );
        expect(
          appointmentStatusForRide('driverArrived'),
          AppointmentStatus.patientPreparing,
        );
        expect(
          appointmentStatusForRide('passengerOnboard'),
          AppointmentStatus.patientEnRoute,
        );
        expect(
          appointmentStatusForRide('arrivedAtDestination'),
          AppointmentStatus.patientArrived,
        );
      });

      test(
        'implies nothing for ride states that say nothing about the visit',
        () {
          expect(appointmentStatusForRide('requested'), isNull);
          expect(appointmentStatusForRide('driverEnRoute'), isNull);
          expect(appointmentStatusForRide('completed'), isNull);
        },
      );
    });
  });
}

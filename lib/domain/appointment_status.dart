import '../core/failures.dart';

/// The lifecycle of an appointment.
///
/// CareBridge *records* appointments; it does not book them into a clinic
/// system. `confirmed` therefore means "a human confirmed this with the clinic",
/// not "an integration returned success".
enum AppointmentStatus {
  draft,
  scheduled,
  confirmed,
  patientPreparing,
  transportationScheduled,
  patientEnRoute,
  patientArrived,
  completed,
  canceled,
  missed;

  String get label => switch (this) {
        AppointmentStatus.draft => 'Draft',
        AppointmentStatus.scheduled => 'Scheduled',
        AppointmentStatus.confirmed => 'Confirmed',
        AppointmentStatus.patientPreparing => 'Getting ready',
        AppointmentStatus.transportationScheduled => 'Transport booked',
        AppointmentStatus.patientEnRoute => 'On the way',
        AppointmentStatus.patientArrived => 'Arrived at the clinic',
        AppointmentStatus.completed => 'Completed',
        AppointmentStatus.canceled => 'Canceled',
        AppointmentStatus.missed => 'Missed',
      };

  bool get isTerminal =>
      this == AppointmentStatus.completed ||
      this == AppointmentStatus.canceled ||
      this == AppointmentStatus.missed;

  /// Appointments a family can still act on — reschedule, book transport, cancel.
  bool get isUpcoming => !isTerminal;
}

const Map<AppointmentStatus, Set<AppointmentStatus>> _allowed = {
  AppointmentStatus.draft: {
    AppointmentStatus.scheduled,
    AppointmentStatus.canceled,
  },
  AppointmentStatus.scheduled: {
    AppointmentStatus.confirmed,
    AppointmentStatus.transportationScheduled,
    AppointmentStatus.patientPreparing,
    AppointmentStatus.canceled,
    AppointmentStatus.missed,
  },
  AppointmentStatus.confirmed: {
    AppointmentStatus.transportationScheduled,
    AppointmentStatus.patientPreparing,
    AppointmentStatus.canceled,
    AppointmentStatus.missed,
  },
  AppointmentStatus.transportationScheduled: {
    AppointmentStatus.patientPreparing,
    AppointmentStatus.patientEnRoute,
    AppointmentStatus.canceled,
    AppointmentStatus.missed,
  },
  AppointmentStatus.patientPreparing: {
    AppointmentStatus.patientEnRoute,
    AppointmentStatus.canceled,
    AppointmentStatus.missed,
  },
  AppointmentStatus.patientEnRoute: {
    AppointmentStatus.patientArrived,
    AppointmentStatus.canceled,
    AppointmentStatus.missed,
  },
  AppointmentStatus.patientArrived: {
    AppointmentStatus.completed,
    AppointmentStatus.canceled,
  },
  AppointmentStatus.completed: {},
  AppointmentStatus.canceled: {},
  AppointmentStatus.missed: {},
};

bool canTransitionAppointment(AppointmentStatus from, AppointmentStatus to) =>
    _allowed[from]?.contains(to) ?? false;

Set<AppointmentStatus> allowedAppointmentTransitions(AppointmentStatus from) =>
    _allowed[from] ?? const {};

void assertAppointmentTransition(
  AppointmentStatus from,
  AppointmentStatus to,
) {
  if (!canTransitionAppointment(from, to)) {
    throw InvalidTransitionFailure(from.name, to.name);
  }
}

/// The appointment status implied by a ride reaching [rideStatus].
///
/// Ride progress drives appointment progress — the family should not have to
/// keep two things in their head. Returns null when the ride change implies
/// nothing about the appointment.
AppointmentStatus? appointmentStatusForRide(String rideStatusName) =>
    switch (rideStatusName) {
      'assigned' => AppointmentStatus.transportationScheduled,
      'driverArrived' => AppointmentStatus.patientPreparing,
      'passengerOnboard' => AppointmentStatus.patientEnRoute,
      'arrivedAtDestination' => AppointmentStatus.patientArrived,
      _ => null,
    };

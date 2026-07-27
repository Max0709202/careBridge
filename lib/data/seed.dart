import '../core/geo.dart';
import '../domain/appointment_status.dart';
import '../domain/models.dart';
import '../domain/permissions.dart';
import '../domain/pricing.dart';
import '../domain/ride_status.dart';
import 'care_state.dart';

/// Demo data for the local build.
///
/// Every person, address, telephone number and vehicle here is invented. Real
/// patient or health data must never appear in a seed, a fixture, a screenshot
/// or a test name — including "just for a demo", because demo data has a habit
/// of outliving the demo.
///
/// This stands in for the API. When `apps/api` lands, `CareState` is populated
/// from it and this file becomes test fixtures only.
CareState buildSeedState(DateTime now) {
  final user = const AppUser(
    id: 'user-demo',
    email: 'sarah@example.com',
    fullName: 'Sarah Whitfield',
    phone: '+1 614 555 0148',
  );

  const home = Address(
    label: 'Home',
    line1: '184 Maplewood Drive',
    city: 'Grandview Heights',
    state: 'OH',
    postalCode: '43212',
    accessNotes: 'Blue front door. Please ring the bell and wait — it takes '
        'Eleanor a couple of minutes to reach the door.',
    coordinates: Coordinates(39.9925, -83.0281),
  );

  const fathersHome = Address(
    label: 'Home',
    line1: '9 Cedarbrook Court, Apt 2B',
    city: 'Upper Arlington',
    state: 'OH',
    postalCode: '43221',
    accessNotes: 'Ground-floor flat, ramp at the side entrance. Gate code 4417.',
    coordinates: Coordinates(40.0192, -83.0624),
  );

  final eleanor = Patient(
    id: 'patient-eleanor',
    preferredName: 'Eleanor',
    legalName: 'Eleanor M. Whitfield',
    phone: '+1 614 555 0193',
    homeAddress: home,
    ageBand: AgeBand.from75to84,
    mobilityNeeds: const {MobilityNeed.walker, MobilityNeed.escortToDoor},
    mobilityNotes: 'Steady on level ground with the walker, but needs an arm on '
        'kerbs and steps. Hard of hearing on the left side.',
    preferredClinicId: 'clinic-riverbend',
    emergencyContacts: const [
      EmergencyContact(
        id: 'ec-1',
        name: 'Sarah Whitfield',
        relationship: 'Daughter',
        phone: '+1 614 555 0148',
        isPrimary: true,
      ),
      EmergencyContact(
        id: 'ec-2',
        name: 'Dennis Whitfield',
        relationship: 'Son',
        phone: '+1 614 555 0176',
      ),
    ],
  );

  final frank = Patient(
    id: 'patient-frank',
    preferredName: 'Frank',
    phone: '+1 614 555 0157',
    homeAddress: fathersHome,
    ageBand: AgeBand.over85,
    mobilityNeeds: const {
      MobilityNeed.wheelchair,
      MobilityNeed.transferAssistance,
    },
    mobilityNotes: 'Uses a manual wheelchair and needs help transferring. '
        'A wheelchair-accessible vehicle is required for every trip.',
    preferredClinicId: 'clinic-northside',
    emergencyContacts: const [
      EmergencyContact(
        id: 'ec-3',
        name: 'Sarah Whitfield',
        relationship: 'Daughter',
        phone: '+1 614 555 0148',
        isPrimary: true,
      ),
    ],
  );

  const clinics = [
    Clinic(
      id: 'clinic-riverbend',
      name: 'Riverbend Cardiology',
      phone: '+1 614 555 0110',
      address: Address(
        label: 'Riverbend Cardiology',
        line1: '2200 Olentangy River Road',
        line2: 'Suite 300',
        city: 'Columbus',
        state: 'OH',
        postalCode: '43210',
        coordinates: Coordinates(39.9612, -82.9988),
      ),
      entranceNotes: 'Drop-off is at the North entrance, not the main lobby. '
          'The multi-storey car park entrance looks similar — it is not it.',
      operatingNotes: 'Mon–Fri, 8am–5pm. Ask for the cardiology desk on floor 3.',
    ),
    Clinic(
      id: 'clinic-northside',
      name: 'Northside Family Medicine',
      phone: '+1 614 555 0129',
      address: Address(
        label: 'Northside Family Medicine',
        line1: '41 Kenny Road',
        city: 'Columbus',
        state: 'OH',
        postalCode: '43220',
        coordinates: Coordinates(40.0341, -83.0512),
      ),
      entranceNotes: 'Step-free entrance on the east side of the building.',
      operatingNotes: 'Mon–Sat, 7:30am–6pm.',
    ),
  ];

  final access = <String, PatientAccess>{
    eleanor.id: PatientAccess(
      userId: user.id,
      patientId: eleanor.id,
      relationship: RelationshipType.daughter,
      permissions: PatientAccess.all,
      grantedAt: now.subtract(const Duration(days: 96)),
    ),
    frank.id: PatientAccess(
      userId: user.id,
      patientId: frank.id,
      relationship: RelationshipType.daughter,
      permissions: PatientAccess.all,
      grantedAt: now.subtract(const Duration(days: 96)),
    ),
  };

  // The appointment the demo is built around: a cardiology follow-up two days
  // out, with transport already booked and awaiting a driver.
  final followUpStart = _atTime(now.add(const Duration(days: 2)), 10, 40);
  final followUp = Appointment(
    id: 'appt-followup',
    patientId: eleanor.id,
    clinicId: 'clinic-riverbend',
    startsAt: followUpStart,
    expectedDuration: const Duration(minutes: 45),
    type: AppointmentType.followUp,
    status: AppointmentStatus.transportationScheduled,
    coordinationNotes: 'Bring the walker. Dr Osei asked for the blood-pressure '
        'diary — it is on the kitchen counter.',
    transportRequired: true,
    timeZoneLabel: 'clinic time',
    createdAt: now.subtract(const Duration(days: 6)),
    history: [
      recordChange(
        at: now.subtract(const Duration(days: 6)),
        from: AppointmentStatus.draft,
        to: AppointmentStatus.scheduled,
        actor: 'Sarah Whitfield',
      ),
      recordChange(
        at: now.subtract(const Duration(days: 5)),
        from: AppointmentStatus.scheduled,
        to: AppointmentStatus.transportationScheduled,
        actor: 'CareBridge',
      ),
    ],
  );

  final frankAppointment = Appointment(
    id: 'appt-frank-checkup',
    patientId: frank.id,
    clinicId: 'clinic-northside',
    startsAt: _atTime(now.add(const Duration(days: 9)), 14, 15),
    expectedDuration: const Duration(minutes: 30),
    type: AppointmentType.primaryCare,
    status: AppointmentStatus.scheduled,
    coordinationNotes: 'Annual check. Wheelchair-accessible vehicle needed.',
    createdAt: now.subtract(const Duration(days: 2)),
    history: [
      recordChange(
        at: now.subtract(const Duration(days: 2)),
        from: AppointmentStatus.draft,
        to: AppointmentStatus.scheduled,
        actor: 'Sarah Whitfield',
      ),
    ],
  );

  final pastAppointmentStart = _atTime(now.subtract(const Duration(days: 21)), 9, 15);
  final pastAppointment = Appointment(
    id: 'appt-past',
    patientId: eleanor.id,
    clinicId: 'clinic-riverbend',
    startsAt: pastAppointmentStart,
    expectedDuration: const Duration(minutes: 60),
    type: AppointmentType.specialist,
    status: AppointmentStatus.completed,
    transportRequired: true,
    createdAt: now.subtract(const Duration(days: 30)),
    history: [
      recordChange(
        at: now.subtract(const Duration(days: 30)),
        from: AppointmentStatus.draft,
        to: AppointmentStatus.scheduled,
        actor: 'Sarah Whitfield',
      ),
      recordChange(
        at: pastAppointmentStart.add(const Duration(minutes: 70)),
        from: AppointmentStatus.patientArrived,
        to: AppointmentStatus.completed,
        actor: 'CareBridge',
      ),
    ],
  );

  const marcus = Driver(
    id: 'driver-marcus',
    displayName: 'Marcus T.',
    rating: 4.9,
    yearsDriving: 6,
    vehicle: Vehicle(
      make: 'Toyota',
      model: 'Sienna',
      color: 'Silver',
      licensePlate: 'OH·4KJ 219',
    ),
  );

  final estimate = _estimate(eleanor, home, clinics.first.address);

  final upcomingRide = Ride(
    id: 'ride-upcoming',
    patientId: eleanor.id,
    appointmentId: followUp.id,
    roundTripGroupId: 'group-followup',
    direction: RideDirection.outbound,
    pickup: home,
    destination: clinics.first.address,
    scheduledPickupAt: followUpStart.subtract(const Duration(minutes: 40)),
    status: RideStatus.awaitingAssignment,
    assistanceRequired: true,
    notesForDriver: 'Please ring the bell and allow a couple of minutes. '
        'Eleanor is hard of hearing on the left side.',
    estimate: estimate,
    createdAt: now.subtract(const Duration(days: 5)),
    history: [
      recordChange(
        at: now.subtract(const Duration(days: 5)),
        from: RideStatus.draft,
        to: RideStatus.requested,
        actor: 'Sarah Whitfield',
      ),
      recordChange(
        at: now.subtract(const Duration(days: 5)),
        from: RideStatus.requested,
        to: RideStatus.awaitingAssignment,
        actor: 'CareBridge',
      ),
    ],
    events: [
      RideEvent(at: now.subtract(const Duration(days: 5)), title: 'Ride requested'),
      RideEvent(
        at: now.subtract(const Duration(days: 5)),
        title: 'Looking for a driver',
      ),
    ],
  );

  final returnRide = Ride(
    id: 'ride-upcoming-return',
    patientId: eleanor.id,
    appointmentId: followUp.id,
    roundTripGroupId: 'group-followup',
    direction: RideDirection.returnTrip,
    pickup: clinics.first.address,
    destination: home,
    scheduledPickupAt: followUp.endsAt,
    flexibleReturn: true,
    status: RideStatus.requested,
    assistanceRequired: true,
    estimate: estimate,
    createdAt: now.subtract(const Duration(days: 5)),
    history: [
      recordChange(
        at: now.subtract(const Duration(days: 5)),
        from: RideStatus.draft,
        to: RideStatus.requested,
        actor: 'Sarah Whitfield',
      ),
    ],
    events: [
      RideEvent(
        at: now.subtract(const Duration(days: 5)),
        title: 'Return ride requested',
        detail: 'Pickup time is flexible — we will send a car when the visit ends.',
      ),
    ],
  );

  final pastRide = Ride(
    id: 'ride-past',
    patientId: eleanor.id,
    appointmentId: pastAppointment.id,
    direction: RideDirection.outbound,
    pickup: home,
    destination: clinics.first.address,
    scheduledPickupAt: pastAppointmentStart.subtract(const Duration(minutes: 40)),
    status: RideStatus.completed,
    assistanceRequired: true,
    driver: marcus,
    estimate: estimate,
    createdAt: now.subtract(const Duration(days: 30)),
    history: const [],
    events: [
      RideEvent(
        at: pastAppointmentStart.subtract(const Duration(minutes: 42)),
        title: 'Driver arrived at pickup',
      ),
      RideEvent(
        at: pastAppointmentStart.subtract(const Duration(minutes: 36)),
        title: 'Picked up safely',
      ),
      RideEvent(
        at: pastAppointmentStart.subtract(const Duration(minutes: 12)),
        title: 'Arrived at the clinic',
      ),
      RideEvent(
        at: pastAppointmentStart.subtract(const Duration(minutes: 10)),
        title: 'Ride completed',
      ),
    ],
  );

  final notifications = [
    AppNotification(
      id: 'n-1',
      kind: NotificationKind.rideRequested,
      title: 'Round trip requested',
      body: 'We are finding a driver. You will be notified when one is assigned.',
      createdAt: now.subtract(const Duration(days: 5)),
      readAt: now.subtract(const Duration(days: 5)),
    ),
    AppNotification(
      id: 'n-2',
      kind: NotificationKind.appointmentReminder,
      title: 'Appointment in two days',
      body: 'A reminder about an upcoming appointment. Open CareBridge for details.',
      createdAt: now.subtract(const Duration(hours: 4)),
      appointmentId: followUp.id,
    ),
  ];

  return CareState(
    user: user,
    patients: [eleanor, frank],
    access: access,
    clinics: clinics,
    appointments: [followUp, frankAppointment, pastAppointment],
    rides: [upcomingRide, returnRide, pastRide],
    notifications: notifications,
    selectedPatientId: eleanor.id,
  );
}

PriceEstimate _estimate(Patient patient, Address from, Address to) {
  final miles = distanceMiles(from.coordinates!, to.coordinates!);
  return estimateFare(
    rule: PricingRule.standard(),
    distanceMiles: double.parse(miles.toStringAsFixed(1)),
    durationMinutes: estimateDriveMinutes(miles),
    wheelchairAccessRequired: patient.requiresWheelchairVehicle,
    assistanceRequired: patient.requiresAssistance,
  );
}

DateTime _atTime(DateTime day, int hour, int minute) =>
    DateTime(day.year, day.month, day.day, hour, minute);

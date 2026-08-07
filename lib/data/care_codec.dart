/// JSON ⇄ domain mapping.
///
/// Kept out of `domain/` on purpose: those files depend on nothing but `core/`,
/// and a wire format is not a business rule. If the transport changes, this is
/// the only file that moves.
///
/// Decoding is deliberately forgiving about *unknown* values and strict about
/// *missing* ones. An enum member the server has and this build does not falls
/// back rather than crashing the screen — but a required field arriving null is
/// a contract break, and failing loudly beats rendering a half-built object.
library;

import '../core/money.dart';
import '../domain/appointment_status.dart';
import '../domain/models.dart';
import '../domain/permissions.dart';
import '../domain/pricing.dart';
import '../domain/ride_status.dart';
import 'care_state.dart';

// ─── decoding ────────────────────────────────────────────────────────────────

CareState careStateFromJson(Map<String, dynamic> json) {
  final accessJson = (json['access'] as Map<String, dynamic>? ?? const {});

  return CareState(
    user: json['user'] == null
        ? null
        : _userFromJson(json['user'] as Map<String, dynamic>),
    patients: _list(json['patients'], _patientFromJson),
    access: {
      for (final entry in accessJson.entries)
        entry.key: _accessFromJson(entry.value as Map<String, dynamic>),
    },
    clinics: _list(json['clinics'], _clinicFromJson),
    appointments: _list(json['appointments'], _appointmentFromJson),
    rides: _list(json['rides'], _rideFromJson),
    notifications: _list(json['notifications'], _notificationFromJson),
    selectedPatientId: json['selectedPatientId'] as String?,
    simplifiedMode: json['simplifiedMode'] as bool? ?? false,
  );
}

AppUser _userFromJson(Map<String, dynamic> json) => AppUser(
      id: json['id'] as String,
      email: json['email'] as String,
      fullName: json['fullName'] as String,
      phone: json['phone'] as String?,
    );

Address _addressFromJson(Map<String, dynamic> json) => Address(
      label: json['label'] as String,
      line1: json['line1'] as String,
      line2: json['line2'] as String?,
      city: json['city'] as String,
      state: json['state'] as String,
      postalCode: json['postalCode'] as String,
      accessNotes: json['accessNotes'] as String?,
      coordinates: json['latitude'] == null || json['longitude'] == null
          ? null
          : Coordinates(
              (json['latitude'] as num).toDouble(),
              (json['longitude'] as num).toDouble(),
            ),
    );

Patient _patientFromJson(Map<String, dynamic> json) => Patient(
      id: json['id'] as String,
      preferredName: json['preferredName'] as String,
      legalName: json['legalName'] as String?,
      phone: json['phone'] as String,
      homeAddress: _addressFromJson(json['homeAddress'] as Map<String, dynamic>),
      ageBand: _enumOrNull(AgeBand.values, json['ageBand'] as String?),
      preferredLanguage: json['preferredLanguage'] as String? ?? 'English',
      mobilityNeeds: {
        for (final name in (json['mobilityNeeds'] as List? ?? const []))
          ?_enumOrNull(MobilityNeed.values, name as String?),
      },
      mobilityNotes: json['mobilityNotes'] as String?,
      emergencyContacts: _list(json['emergencyContacts'], _contactFromJson),
      preferredClinicId: json['preferredClinicId'] as String?,
      archivedAt: _dateOrNull(json['archivedAt'] as String?),
    );

EmergencyContact _contactFromJson(Map<String, dynamic> json) => EmergencyContact(
      id: json['id'] as String,
      name: json['name'] as String,
      relationship: json['relationship'] as String,
      phone: json['phone'] as String,
      isPrimary: json['isPrimary'] as bool? ?? false,
    );

PatientAccess _accessFromJson(Map<String, dynamic> json) => PatientAccess(
      userId: json['userId'] as String,
      patientId: json['patientId'] as String,
      relationship:
          _enumOrNull(RelationshipType.values, json['relationship'] as String?) ??
              RelationshipType.other,
      permissions: {
        for (final name in (json['permissions'] as List? ?? const []))
          ?_enumOrNull(FamilyPermission.values, name as String?),
      },
      grantedAt: DateTime.parse(json['grantedAt'] as String).toLocal(),
      grantedByUserId: json['grantedByUserId'] as String?,
      revokedAt: _dateOrNull(json['revokedAt'] as String?),
    );

Clinic _clinicFromJson(Map<String, dynamic> json) => Clinic(
      id: json['id'] as String,
      name: json['name'] as String,
      phone: json['phone'] as String,
      address: _addressFromJson(json['address'] as Map<String, dynamic>),
      entranceNotes: json['entranceNotes'] as String?,
      operatingNotes: json['operatingNotes'] as String?,
    );

Appointment _appointmentFromJson(Map<String, dynamic> json) => Appointment(
      id: json['id'] as String,
      patientId: json['patientId'] as String,
      clinicId: json['clinicId'] as String,
      startsAt: DateTime.parse(json['startsAt'] as String).toLocal(),
      expectedDuration:
          Duration(minutes: json['expectedDurationMinutes'] as int),
      type: _enumOrNull(AppointmentType.values, json['type'] as String?) ??
          AppointmentType.other,
      status: _enumOrNull(AppointmentStatus.values, json['status'] as String?) ??
          AppointmentStatus.scheduled,
      coordinationNotes: json['coordinationNotes'] as String?,
      transportRequired: json['transportRequired'] as bool? ?? false,
      timeZoneLabel: json['timeZoneLabel'] as String? ?? 'clinic time',
      history: _list(json['history'], _statusChangeFromJson),
      createdAt: _dateOrNull(json['createdAt'] as String?),
    );

StatusChange _statusChangeFromJson(Map<String, dynamic> json) => StatusChange(
      at: DateTime.parse(json['at'] as String).toLocal(),
      from: json['from'] as String,
      to: json['to'] as String,
      actor: json['actor'] as String,
      reason: json['reason'] as String?,
    );

Ride _rideFromJson(Map<String, dynamic> json) => Ride(
      id: json['id'] as String,
      patientId: json['patientId'] as String,
      appointmentId: json['appointmentId'] as String?,
      roundTripGroupId: json['roundTripGroupId'] as String?,
      direction:
          _enumOrNull(RideDirection.values, json['direction'] as String?) ??
              RideDirection.outbound,
      pickup: _addressFromJson(json['pickup'] as Map<String, dynamic>),
      destination: _addressFromJson(json['destination'] as Map<String, dynamic>),
      scheduledPickupAt:
          DateTime.parse(json['scheduledPickupAt'] as String).toLocal(),
      flexibleReturn: json['flexibleReturn'] as bool? ?? false,
      status: _enumOrNull(RideStatus.values, json['status'] as String?) ??
          RideStatus.requested,
      wheelchairRequired: json['wheelchairRequired'] as bool? ?? false,
      assistanceRequired: json['assistanceRequired'] as bool? ?? false,
      notesForDriver: json['notesForDriver'] as String?,
      driver: json['driver'] == null
          ? null
          : _driverFromJson(json['driver'] as Map<String, dynamic>),
      estimate: _estimateFromJson(json['estimate'] as Map<String, dynamic>),
      isDelayed: json['isDelayed'] as bool? ?? false,
      delayReason: json['delayReason'] as String?,
      cancellationReason: json['cancellationReason'] as String?,
      events: _list(json['events'], _rideEventFromJson),
      history: _list(json['history'], _statusChangeFromJson),
      lastKnownPosition: json['lastKnownPosition'] == null
          ? null
          : _trackingPointFromJson(
              json['lastKnownPosition'] as Map<String, dynamic>),
      etaMinutes: json['etaMinutes'] as int?,
      createdAt: _dateOrNull(json['createdAt'] as String?),
    );

Driver _driverFromJson(Map<String, dynamic> json) => Driver(
      id: json['id'] as String,
      displayName: json['displayName'] as String,
      rating: (json['rating'] as num?)?.toDouble() ?? 5.0,
      yearsDriving: json['yearsDriving'] as int? ?? 1,
      vehicle: _vehicleFromJson(json['vehicle'] as Map<String, dynamic>),
    );

Vehicle _vehicleFromJson(Map<String, dynamic> json) => Vehicle(
      make: json['make'] as String,
      model: json['model'] as String,
      color: json['color'] as String,
      licensePlate: json['licensePlate'] as String,
      isWheelchairAccessible: json['isWheelchairAccessible'] as bool? ?? false,
    );

/// Money crosses the wire as integer cents and is reconstructed as [Money].
/// It is never parsed from a decimal string — that is where rounding creeps in.
PriceEstimate _estimateFromJson(Map<String, dynamic> json) => PriceEstimate(
      ruleVersion: json['ruleVersion'] as String,
      distanceMiles: (json['distanceMiles'] as num).toDouble(),
      durationMinutes: json['durationMinutes'] as int,
      base: Money(json['baseCents'] as int),
      distanceCharge: Money(json['distanceChargeCents'] as int),
      timeCharge: Money(json['timeChargeCents'] as int),
      surcharges: [
        for (final s in (json['surcharges'] as List? ?? const []))
          (
            label: (s as Map<String, dynamic>)['label'] as String,
            amount: Money(s['amountCents'] as int),
          ),
      ],
      total: Money(json['totalCents'] as int),
      minimumApplied: json['minimumApplied'] as bool? ?? false,
    );

RideEvent _rideEventFromJson(Map<String, dynamic> json) => RideEvent(
      at: DateTime.parse(json['at'] as String).toLocal(),
      title: json['title'] as String,
      detail: json['detail'] as String?,
      isException: json['isException'] as bool? ?? false,
    );

TrackingPoint _trackingPointFromJson(Map<String, dynamic> json) => TrackingPoint(
      coordinates: Coordinates(
        (json['latitude'] as num).toDouble(),
        (json['longitude'] as num).toDouble(),
      ),
      // Aged against the moment the *device* took the reading, so a delayed
      // upload can never render as a fresh position.
      capturedAt: DateTime.parse(json['capturedAt'] as String).toLocal(),
      accuracyMeters: (json['accuracyMeters'] as num?)?.toDouble() ?? 12,
    );

AppNotification _notificationFromJson(Map<String, dynamic> json) =>
    AppNotification(
      id: json['id'] as String,
      kind: _enumOrNull(NotificationKind.values, json['kind'] as String?) ??
          NotificationKind.appointmentChanged,
      title: json['title'] as String,
      body: json['body'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
      readAt: _dateOrNull(json['readAt'] as String?),
      rideId: json['rideId'] as String?,
      appointmentId: json['appointmentId'] as String?,
    );

/// The ids of rides the server is currently driving with the preview runner.
///
/// Read straight off the snapshot rather than tracked client-side, so the
/// controls show the right state after a page refresh or on a second device.
Set<String> runningPreviewRideIds(Map<String, dynamic> json) => {
      for (final ride in (json['rides'] as List? ?? const []))
        if ((ride as Map<String, dynamic>)['simulationActive'] == true)
          ride['id'] as String,
    };

// ─── encoding ────────────────────────────────────────────────────────────────

Map<String, dynamic> addressToJson(Address address) => {
      'label': address.label,
      'line1': address.line1,
      if (address.line2 != null && address.line2!.isNotEmpty)
        'line2': address.line2,
      'city': address.city,
      'state': address.state,
      'postalCode': address.postalCode,
      if (address.accessNotes != null && address.accessNotes!.isNotEmpty)
        'accessNotes': address.accessNotes,
      if (address.coordinates != null) ...{
        'latitude': address.coordinates!.latitude,
        'longitude': address.coordinates!.longitude,
      },
    };

Map<String, dynamic> patientToJson(Patient patient) => {
      'preferredName': patient.preferredName,
      if (patient.legalName != null && patient.legalName!.isNotEmpty)
        'legalName': patient.legalName,
      'phone': patient.phone,
      'homeAddress': addressToJson(patient.homeAddress),
      if (patient.ageBand != null) 'ageBand': patient.ageBand!.name,
      'preferredLanguage': patient.preferredLanguage,
      'mobilityNeeds': patient.mobilityNeeds.map((n) => n.name).toList(),
      if (patient.mobilityNotes != null && patient.mobilityNotes!.isNotEmpty)
        'mobilityNotes': patient.mobilityNotes,
      'emergencyContacts': [
        for (final c in patient.emergencyContacts)
          {
            'name': c.name,
            'relationship': c.relationship,
            'phone': c.phone,
            'isPrimary': c.isPrimary,
          },
      ],
      if (patient.preferredClinicId != null)
        'preferredClinicId': patient.preferredClinicId,
    };

Map<String, dynamic> clinicToJson(Clinic clinic) => {
      'name': clinic.name,
      'phone': clinic.phone,
      'address': addressToJson(clinic.address),
      if (clinic.entranceNotes != null && clinic.entranceNotes!.isNotEmpty)
        'entranceNotes': clinic.entranceNotes,
      if (clinic.operatingNotes != null && clinic.operatingNotes!.isNotEmpty)
        'operatingNotes': clinic.operatingNotes,
    };

// ─── helpers ─────────────────────────────────────────────────────────────────

List<T> _list<T>(Object? raw, T Function(Map<String, dynamic>) decode) => [
      for (final item in (raw as List? ?? const []))
        decode(item as Map<String, dynamic>),
    ];

DateTime? _dateOrNull(String? raw) =>
    raw == null ? null : DateTime.parse(raw).toLocal();

T? _enumOrNull<T extends Enum>(List<T> values, String? name) {
  if (name == null) return null;
  for (final value in values) {
    if (value.name == name) return value;
  }
  return null;
}

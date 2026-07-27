/// Domain entities.
///
/// Data minimisation is a design rule here, not a later clean-up. Two absences
/// are deliberate and load-bearing:
///
/// * **No date of birth.** Name + address + date of birth is the classic
///   re-identification triple and the standard identity-verification set for
///   banks and clinics. Nothing in arranging a car and a companion needs it.
///   [AgeBand] covers the one plausible use — mobility planning — at a coarseness
///   that cannot identify anyone.
/// * **No clinical data.** [AppointmentType] is a coordination label, never a
///   condition. Mobility needs are operational, not diagnostic.
library;

import 'appointment_status.dart';
import 'permissions.dart';
import 'pricing.dart';
import 'ride_status.dart';

class Coordinates {
  const Coordinates(this.latitude, this.longitude);

  final double latitude;
  final double longitude;

  Coordinates lerp(Coordinates to, double t) => Coordinates(
        latitude + (to.latitude - latitude) * t,
        longitude + (to.longitude - longitude) * t,
      );
}

class Address {
  const Address({
    required this.label,
    required this.line1,
    required this.city,
    required this.state,
    required this.postalCode,
    this.line2,
    this.accessNotes,
    this.coordinates,
  });

  final String label;
  final String line1;
  final String? line2;
  final String city;
  final String state;
  final String postalCode;

  /// "Gate code 4417", "flat is up one flight, no lift", "use the rear door".
  /// The single most useful free-text field in the product: it is what stops a
  /// driver waiting at the wrong entrance while a patient waits at the right one.
  final String? accessNotes;

  final Coordinates? coordinates;

  String get singleLine => [
        line1,
        if (line2 != null && line2!.isNotEmpty) line2,
        city,
        '$state $postalCode',
      ].join(', ');

  String get shortLine => '$line1, $city';
}

enum AgeBand {
  under65,
  from65to74,
  from75to84,
  over85;

  String get label => switch (this) {
        AgeBand.under65 => 'Under 65',
        AgeBand.from65to74 => '65–74',
        AgeBand.from75to84 => '75–84',
        AgeBand.over85 => '85 or older',
      };
}

enum MobilityNeed {
  walker,
  wheelchair,
  cane,
  oxygen,
  transferAssistance,
  escortToDoor,
  lowVision,
  hardOfHearing,
  memorySupport;

  String get label => switch (this) {
        MobilityNeed.walker => 'Uses a walker',
        MobilityNeed.wheelchair => 'Uses a wheelchair',
        MobilityNeed.cane => 'Uses a cane',
        MobilityNeed.oxygen => 'Travels with oxygen',
        MobilityNeed.transferAssistance => 'Needs help transferring',
        MobilityNeed.escortToDoor => 'Needs escorting to the door',
        MobilityNeed.lowVision => 'Low vision',
        MobilityNeed.hardOfHearing => 'Hard of hearing',
        MobilityNeed.memorySupport => 'Needs memory support',
      };

  /// Needs that constrain which vehicle can be sent, as opposed to needs that
  /// only tell the driver how to help.
  bool get constrainsVehicle =>
      this == MobilityNeed.wheelchair || this == MobilityNeed.oxygen;
}

class EmergencyContact {
  const EmergencyContact({
    required this.id,
    required this.name,
    required this.relationship,
    required this.phone,
    this.isPrimary = false,
  });

  final String id;
  final String name;
  final String relationship;
  final String phone;
  final bool isPrimary;
}

class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.fullName,
    this.phone,
  });

  final String id;
  final String email;
  final String fullName;
  final String? phone;

  String get initials {
    final parts = fullName.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }
}

class Patient {
  const Patient({
    required this.id,
    required this.preferredName,
    required this.phone,
    required this.homeAddress,
    this.legalName,
    this.ageBand,
    this.preferredLanguage = 'English',
    this.mobilityNeeds = const {},
    this.mobilityNotes,
    this.emergencyContacts = const [],
    this.preferredClinicId,
    this.archivedAt,
  });

  final String id;

  /// Required. Someone must be greeted by the name they actually use.
  final String preferredName;

  /// Optional, and collected only when a transport provider or clinic needs it
  /// to match their records. Kept separate from [preferredName] so the
  /// operational need does not force everyone to hand over a legal name.
  final String? legalName;

  final String phone;
  final Address homeAddress;
  final AgeBand? ageBand;
  final String preferredLanguage;
  final Set<MobilityNeed> mobilityNeeds;
  final String? mobilityNotes;
  final List<EmergencyContact> emergencyContacts;
  final String? preferredClinicId;
  final DateTime? archivedAt;

  bool get isArchived => archivedAt != null;

  bool get requiresWheelchairVehicle =>
      mobilityNeeds.contains(MobilityNeed.wheelchair);

  bool get requiresAssistance =>
      mobilityNeeds.contains(MobilityNeed.escortToDoor) ||
      mobilityNeeds.contains(MobilityNeed.transferAssistance);

  String get firstInitial =>
      preferredName.isEmpty ? '?' : preferredName[0].toUpperCase();

  Patient copyWith({
    String? preferredName,
    String? legalName,
    String? phone,
    Address? homeAddress,
    AgeBand? ageBand,
    String? preferredLanguage,
    Set<MobilityNeed>? mobilityNeeds,
    String? mobilityNotes,
    List<EmergencyContact>? emergencyContacts,
    String? preferredClinicId,
    DateTime? archivedAt,
  }) {
    return Patient(
      id: id,
      preferredName: preferredName ?? this.preferredName,
      legalName: legalName ?? this.legalName,
      phone: phone ?? this.phone,
      homeAddress: homeAddress ?? this.homeAddress,
      ageBand: ageBand ?? this.ageBand,
      preferredLanguage: preferredLanguage ?? this.preferredLanguage,
      mobilityNeeds: mobilityNeeds ?? this.mobilityNeeds,
      mobilityNotes: mobilityNotes ?? this.mobilityNotes,
      emergencyContacts: emergencyContacts ?? this.emergencyContacts,
      preferredClinicId: preferredClinicId ?? this.preferredClinicId,
      archivedAt: archivedAt ?? this.archivedAt,
    );
  }
}

class Clinic {
  const Clinic({
    required this.id,
    required this.name,
    required this.phone,
    required this.address,
    this.entranceNotes,
    this.operatingNotes,
  });

  final String id;
  final String name;
  final String phone;
  final Address address;

  /// Where the car should actually stop. Large hospital campuses are the most
  /// common cause of a "the driver could not find them" support call.
  final String? entranceNotes;

  final String? operatingNotes;
}

enum AppointmentType {
  primaryCare,
  specialist,
  imaging,
  labWork,
  therapy,
  dental,
  vision,
  followUp,
  other;

  /// Coarse on purpose. "Specialist" is enough to plan a visit's length and
  /// transport; the specialty itself is clinical information we do not need.
  String get label => switch (this) {
        AppointmentType.primaryCare => 'Primary care',
        AppointmentType.specialist => 'Specialist visit',
        AppointmentType.imaging => 'Imaging',
        AppointmentType.labWork => 'Lab work',
        AppointmentType.therapy => 'Therapy',
        AppointmentType.dental => 'Dental',
        AppointmentType.vision => 'Vision',
        AppointmentType.followUp => 'Follow-up',
        AppointmentType.other => 'Other',
      };
}

class StatusChange {
  const StatusChange({
    required this.at,
    required this.from,
    required this.to,
    required this.actor,
    this.reason,
  });

  final DateTime at;
  final String from;
  final String to;
  final String actor;
  final String? reason;
}

class Appointment {
  const Appointment({
    required this.id,
    required this.patientId,
    required this.clinicId,
    required this.startsAt,
    required this.expectedDuration,
    required this.type,
    required this.status,
    this.coordinationNotes,
    this.transportRequired = false,
    this.timeZoneLabel = 'local time',
    this.history = const [],
    this.createdAt,
  });

  final String id;
  final String patientId;
  final String clinicId;
  final DateTime startsAt;
  final Duration expectedDuration;
  final AppointmentType type;
  final AppointmentStatus status;

  /// Logistics only: "bring the walker", "Dr Osei's office is on floor 3".
  /// Never symptoms, diagnoses, or medication.
  final String? coordinationNotes;

  final bool transportRequired;

  /// Appointment times are always shown in the *clinic's* zone, labelled — never
  /// silently converted to the viewer's zone. A daughter in Seattle booking for
  /// a mother in Ohio must not see a time that is three hours wrong.
  final String timeZoneLabel;

  final List<StatusChange> history;
  final DateTime? createdAt;

  DateTime get endsAt => startsAt.add(expectedDuration);

  Appointment copyWith({
    String? clinicId,
    DateTime? startsAt,
    Duration? expectedDuration,
    AppointmentType? type,
    AppointmentStatus? status,
    String? coordinationNotes,
    bool? transportRequired,
    List<StatusChange>? history,
  }) {
    return Appointment(
      id: id,
      patientId: patientId,
      clinicId: clinicId ?? this.clinicId,
      startsAt: startsAt ?? this.startsAt,
      expectedDuration: expectedDuration ?? this.expectedDuration,
      type: type ?? this.type,
      status: status ?? this.status,
      coordinationNotes: coordinationNotes ?? this.coordinationNotes,
      transportRequired: transportRequired ?? this.transportRequired,
      timeZoneLabel: timeZoneLabel,
      history: history ?? this.history,
      createdAt: createdAt,
    );
  }
}

class Vehicle {
  const Vehicle({
    required this.make,
    required this.model,
    required this.color,
    required this.licensePlate,
    this.isWheelchairAccessible = false,
  });

  final String make;
  final String model;
  final String color;
  final String licensePlate;
  final bool isWheelchairAccessible;

  String get description => '$color $make $model';
}

class Driver {
  const Driver({
    required this.id,
    required this.displayName,
    required this.vehicle,
    this.rating = 5.0,
    this.yearsDriving = 1,
  });

  final String id;

  /// First name and last initial. The family needs to recognise the person at
  /// the kerb, not to be able to look them up.
  final String displayName;

  final Vehicle vehicle;
  final double rating;
  final int yearsDriving;

  String get initials {
    final parts = displayName.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }
}

enum RideDirection {
  outbound,
  returnTrip;

  String get label => switch (this) {
        RideDirection.outbound => 'To the clinic',
        RideDirection.returnTrip => 'Home again',
      };
}

class RideEvent {
  const RideEvent({
    required this.at,
    required this.title,
    this.detail,
    this.isException = false,
  });

  final DateTime at;
  final String title;
  final String? detail;

  /// Delays, no-shows and reassignments. Rendered differently: an exception the
  /// family should read, not a routine tick.
  final bool isException;
}

/// A position report from the driver's device.
class TrackingPoint {
  const TrackingPoint({
    required this.coordinates,
    required this.capturedAt,
    this.accuracyMeters = 12,
  });

  final Coordinates coordinates;

  /// When the *device* took the reading — not when the server received it. The
  /// UI ages everything against this, so a delayed upload cannot be rendered as
  /// a fresh position.
  final DateTime capturedAt;

  final double accuracyMeters;
}

class Ride {
  const Ride({
    required this.id,
    required this.patientId,
    required this.direction,
    required this.pickup,
    required this.destination,
    required this.scheduledPickupAt,
    required this.status,
    required this.estimate,
    this.appointmentId,
    this.roundTripGroupId,
    this.flexibleReturn = false,
    this.wheelchairRequired = false,
    this.assistanceRequired = false,
    this.notesForDriver,
    this.driver,
    this.isDelayed = false,
    this.delayReason,
    this.cancellationReason,
    this.events = const [],
    this.history = const [],
    this.lastKnownPosition,
    this.etaMinutes,
    this.createdAt,
  });

  final String id;
  final String patientId;
  final String? appointmentId;

  /// Set on both legs of a round trip. The two legs are separate rides.
  final String? roundTripGroupId;

  final RideDirection direction;
  final Address pickup;
  final Address destination;
  final DateTime scheduledPickupAt;

  /// True when the family cannot know in advance when the visit will end, so the
  /// return leg is dispatched on request rather than at a fixed time. This is the
  /// normal case for a return leg, not an edge case.
  final bool flexibleReturn;

  final RideStatus status;
  final bool wheelchairRequired;
  final bool assistanceRequired;
  final String? notesForDriver;
  final Driver? driver;
  final PriceEstimate estimate;

  /// Delay is a flag, not a status — see [RideStatus] for why.
  final bool isDelayed;
  final String? delayReason;

  final String? cancellationReason;
  final List<RideEvent> events;
  final List<StatusChange> history;
  final TrackingPoint? lastKnownPosition;
  final int? etaMinutes;
  final DateTime? createdAt;

  bool get isActive => !status.isTerminal;

  bool get isTrackable => status.allowsLocationSharing;

  Ride copyWith({
    RideStatus? status,
    Driver? driver,
    DateTime? scheduledPickupAt,
    bool? isDelayed,
    String? delayReason,
    String? cancellationReason,
    String? notesForDriver,
    List<RideEvent>? events,
    List<StatusChange>? history,
    TrackingPoint? lastKnownPosition,
    int? etaMinutes,
    bool clearDriver = false,
    bool clearEta = false,
  }) {
    return Ride(
      id: id,
      patientId: patientId,
      appointmentId: appointmentId,
      roundTripGroupId: roundTripGroupId,
      direction: direction,
      pickup: pickup,
      destination: destination,
      scheduledPickupAt: scheduledPickupAt ?? this.scheduledPickupAt,
      flexibleReturn: flexibleReturn,
      status: status ?? this.status,
      wheelchairRequired: wheelchairRequired,
      assistanceRequired: assistanceRequired,
      notesForDriver: notesForDriver ?? this.notesForDriver,
      driver: clearDriver ? null : (driver ?? this.driver),
      estimate: estimate,
      isDelayed: isDelayed ?? this.isDelayed,
      delayReason: delayReason ?? this.delayReason,
      cancellationReason: cancellationReason ?? this.cancellationReason,
      events: events ?? this.events,
      history: history ?? this.history,
      lastKnownPosition: lastKnownPosition ?? this.lastKnownPosition,
      etaMinutes: clearEta ? null : (etaMinutes ?? this.etaMinutes),
      createdAt: createdAt,
    );
  }
}

enum NotificationKind {
  appointmentCreated,
  appointmentReminder,
  appointmentChanged,
  appointmentCanceled,
  rideRequested,
  driverAssigned,
  driverEnRoute,
  driverArrivingSoon,
  driverArrived,
  patientPickedUp,
  patientArrived,
  rideDelayed,
  rideCompleted,
  rideCanceled,
  accessGranted;

  bool get isUrgent =>
      this == NotificationKind.driverArrived ||
      this == NotificationKind.rideDelayed ||
      this == NotificationKind.rideCanceled;
}

/// An in-app notification.
///
/// Bodies are deliberately contentless — no clinic name, no address, no
/// appointment time, no patient name. A phone on a kitchen table is readable by
/// whoever is in the room, and for an older adult that may include the person
/// they most need privacy from. A compromised inbox should yield nothing.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    required this.createdAt,
    this.readAt,
    this.rideId,
    this.appointmentId,
  });

  final String id;
  final NotificationKind kind;
  final String title;
  final String body;
  final DateTime createdAt;
  final DateTime? readAt;
  final String? rideId;
  final String? appointmentId;

  bool get isRead => readAt != null;

  AppNotification markRead(DateTime at) => AppNotification(
        id: id,
        kind: kind,
        title: title,
        body: body,
        createdAt: createdAt,
        readAt: at,
        rideId: rideId,
        appointmentId: appointmentId,
      );
}

/// Everything one signed-in user can see, resolved through their access grants.
class CareCircle {
  const CareCircle({
    required this.user,
    required this.patients,
    required this.access,
  });

  final AppUser user;
  final List<Patient> patients;
  final Map<String, PatientAccess> access;

  bool can(String patientId, FamilyPermission permission) =>
      access[patientId]?.can(permission) ?? false;
}

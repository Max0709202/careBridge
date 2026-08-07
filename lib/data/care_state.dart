import '../domain/appointment_status.dart';
import '../domain/models.dart';
import '../domain/permissions.dart';
import '../domain/ride_status.dart';

/// The whole of what one signed-in user can see, as one immutable value.
///
/// Operations in `care_operations.dart` are pure functions over this type:
/// `CareState -> CareState`. That keeps every business rule — status machines,
/// permission checks, notification generation — testable without a widget, a
/// container, or a network.
class CareState {
  const CareState({
    this.user,
    this.patients = const [],
    this.access = const {},
    this.clinics = const [],
    this.appointments = const [],
    this.rides = const [],
    this.notifications = const [],
    this.selectedPatientId,
    this.simplifiedMode = false,
  });

  final AppUser? user;
  final List<Patient> patients;

  /// Keyed by patient id. The authorisation edge — see [PatientAccess].
  final Map<String, PatientAccess> access;

  final List<Clinic> clinics;
  final List<Appointment> appointments;
  final List<Ride> rides;
  final List<AppNotification> notifications;
  final String? selectedPatientId;

  /// Larger type, higher contrast, fewer controls. Intended for a patient
  /// holding the phone themselves, or for a family member who simply prefers it.
  final bool simplifiedMode;

  bool get isSignedIn => user != null;

  List<Patient> get activePatients => patients
      .where((p) => !p.isArchived && canView(p.id))
      .toList(growable: false);

  Patient? get selectedPatient {
    final id = selectedPatientId;
    if (id == null || !canView(id)) return null;
    return patientById(id);
  }

  Patient? patientById(String id) {
    for (final p in patients) {
      if (p.id == id) return p;
    }
    return null;
  }

  Clinic? clinicById(String id) {
    for (final c in clinics) {
      if (c.id == id) return c;
    }
    return null;
  }

  Appointment? appointmentById(String id) {
    for (final a in appointments) {
      if (a.id == id) return a;
    }
    return null;
  }

  Ride? rideById(String id) {
    for (final r in rides) {
      if (r.id == id) return r;
    }
    return null;
  }

  bool can(String patientId, FamilyPermission permission) =>
      access[patientId]?.can(permission) ?? false;

  /// Whether this account may see anything at all about a person.
  ///
  /// [patientById] and friends are plain lookups over what happens to be in
  /// memory; they are not authorisation. Anything that puts a person, their
  /// appointments or their rides on screen resolves through here first, so a
  /// grant that was never given — or has since been revoked — closes every
  /// surface at once rather than one screen at a time.
  bool canView(String patientId) =>
      can(patientId, FamilyPermission.viewProfile);

  /// Appointments for a patient, soonest first.
  List<Appointment> appointmentsFor(String patientId) {
    final list = appointments.where((a) => a.patientId == patientId).toList()
      ..sort((a, b) => a.startsAt.compareTo(b.startsAt));
    return list;
  }

  List<Appointment> upcomingFor(String patientId, DateTime now) =>
      appointmentsFor(patientId)
          .where((a) => a.status.isUpcoming && a.endsAt.isAfter(now))
          .toList(growable: false);

  List<Appointment> pastFor(String patientId, DateTime now) {
    final list = appointmentsFor(patientId)
        .where((a) => !a.status.isUpcoming || a.endsAt.isBefore(now))
        .toList()
      ..sort((a, b) => b.startsAt.compareTo(a.startsAt));
    return list;
  }

  Appointment? nextAppointmentFor(String patientId, DateTime now) {
    final upcoming = upcomingFor(patientId, now);
    return upcoming.isEmpty ? null : upcoming.first;
  }

  List<Ride> ridesFor(String patientId) {
    final list = rides.where((r) => r.patientId == patientId).toList()
      ..sort((a, b) => a.scheduledPickupAt.compareTo(b.scheduledPickupAt));
    return list;
  }

  List<Ride> ridesForAppointment(String appointmentId) =>
      rides.where((r) => r.appointmentId == appointmentId).toList(growable: false)
        ..sort((a, b) => a.scheduledPickupAt.compareTo(b.scheduledPickupAt));

  /// The one ride that deserves the top of the dashboard: in progress if there
  /// is one, otherwise the next one that has been requested.
  Ride? activeRideFor(String patientId) {
    final candidates = ridesFor(patientId).where((r) => r.isActive).toList();
    if (candidates.isEmpty) return null;
    for (final r in candidates) {
      if (r.status.allowsLocationSharing) return r;
    }
    return candidates.first;
  }

  List<Ride> get allActiveRides =>
      rides.where((r) => r.isActive).toList(growable: false);

  int get unreadNotificationCount =>
      notifications.where((n) => !n.isRead).length;

  List<AppNotification> get notificationsNewestFirst {
    final list = [...notifications]
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return list;
  }

  CareState copyWith({
    AppUser? user,
    List<Patient>? patients,
    Map<String, PatientAccess>? access,
    List<Clinic>? clinics,
    List<Appointment>? appointments,
    List<Ride>? rides,
    List<AppNotification>? notifications,
    String? selectedPatientId,
    bool? simplifiedMode,
    bool signOut = false,
  }) {
    if (signOut) return const CareState();
    return CareState(
      user: user ?? this.user,
      patients: patients ?? this.patients,
      access: access ?? this.access,
      clinics: clinics ?? this.clinics,
      appointments: appointments ?? this.appointments,
      rides: rides ?? this.rides,
      notifications: notifications ?? this.notifications,
      selectedPatientId: selectedPatientId ?? this.selectedPatientId,
      simplifiedMode: simplifiedMode ?? this.simplifiedMode,
    );
  }
}

/// Convenience for building a status-history entry.
StatusChange recordChange({
  required DateTime at,
  required Object from,
  required Object to,
  required String actor,
  String? reason,
}) {
  return StatusChange(
    at: at,
    from: _name(from),
    to: _name(to),
    actor: actor,
    reason: reason,
  );
}

String _name(Object value) => switch (value) {
      RideStatus s => s.name,
      AppointmentStatus s => s.name,
      _ => value.toString(),
    };

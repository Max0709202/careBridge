/// The dispatch rules, as the console renders them. Mirrors
/// apps/api/src/domain/dispatch.ts and apps/api/src/domain/driver-status.ts.
///
/// Like `lib/domain/` in the family app, this copy **decides nothing**. The
/// server asserts every assignment — `assertAssignable` throws rather than
/// returning a boolean a caller can forget to read — and this file exists so a
/// dispatcher sees *why* a driver is unavailable before they tap, rather than
/// after. Deleting it would change no outcome except which rows look tappable.
///
/// The distinction matters more here than on the family side. A dispatcher
/// under pressure at 8am is not the last line of defence against a patient in
/// a wheelchair meeting a saloon car at the kerb; the server is. This is the
/// part that makes the queue legible enough that they rarely find out.
library;

/// How close a ride is to needing a car.
enum DispatchUrgency {
  /// The pickup time has passed with nobody assigned.
  overdue,
  imminent,
  soon,
  later;

  static DispatchUrgency? tryParse(String? value) {
    for (final urgency in DispatchUrgency.values) {
      if (urgency.name == value) return urgency;
    }
    return null;
  }

  String get wire => name;

  /// What the band is called on screen.
  ///
  /// `overdue` is deliberately not "very urgent". It is a failure already in
  /// progress — somebody is standing in a hallway waiting — and a dispatcher
  /// scanning a queue needs that to read differently from "do this next".
  String get label => switch (this) {
    DispatchUrgency.overdue => 'Overdue',
    DispatchUrgency.imminent => 'Within 30 min',
    DispatchUrgency.soon => 'Within 2 hours',
    DispatchUrgency.later => 'Later',
  };

  /// Sort weight, matching `URGENCY_ORDER` on the server.
  int get order => switch (this) {
    DispatchUrgency.overdue => 0,
    DispatchUrgency.imminent => 1,
    DispatchUrgency.soon => 2,
    DispatchUrgency.later => 3,
  };

  /// Whether the row should be shown as demanding attention rather than
  /// merely scheduled.
  bool get isPressing =>
      this == DispatchUrgency.overdue || this == DispatchUrgency.imminent;
}

/// Why a driver cannot take a particular trip.
///
/// Every reason is carried, never just the first, because a dispatcher looking
/// at an empty candidate list has to know whether the answer is "nobody is on
/// shift" or "nobody has an accessible vehicle". Those need different phone
/// calls, and collapsing them to "no drivers available" turns a two-minute fix
/// into a cancelled appointment.
enum IneligibilityReason {
  notApproved,
  offShift,
  noAccessibleVehicle,
  alreadyOnARide;

  static IneligibilityReason? tryParse(String? value) {
    for (final reason in IneligibilityReason.values) {
      if (reason.name == value) return reason;
    }
    return null;
  }

  String get wire => name;

  String get label => switch (this) {
    IneligibilityReason.notApproved => 'Not approved to carry passengers',
    IneligibilityReason.offShift => 'Not on shift',
    IneligibilityReason.noAccessibleVehicle =>
      'No wheelchair-accessible vehicle',
    IneligibilityReason.alreadyOnARide => 'Already on a trip',
  };

  /// What a dispatcher could actually do about it, where there is something.
  ///
  /// `noAccessibleVehicle` has no suggestion on purpose: the answer is another
  /// vehicle, not another decision, and offering "assign anyway" is exactly
  /// the affordance the server refuses.
  String? get remedy => switch (this) {
    IneligibilityReason.offShift => 'Put them on shift from the roster',
    IneligibilityReason.notApproved => 'Approve them from the roster',
    IneligibilityReason.alreadyOnARide =>
      'Wait for their current trip to finish',
    IneligibilityReason.noAccessibleVehicle => null,
  };
}

/// The lifecycle of a driver at an operator.
enum DriverStatus {
  invited,
  pendingApproval,

  /// May be assigned rides. The only status that occupies a billable seat.
  approved,
  suspended,
  offboarded;

  static DriverStatus? tryParse(String? value) {
    for (final status in DriverStatus.values) {
      if (status.name == value) return status;
    }
    return null;
  }

  String get wire => name;

  String get label => switch (this) {
    DriverStatus.invited => 'Invited',
    DriverStatus.pendingApproval => 'Awaiting approval',
    DriverStatus.approved => 'Approved',
    DriverStatus.suspended => 'Suspended',
    DriverStatus.offboarded => 'Offboarded',
  };

  /// Whether this driver counts towards the per-driver subscription.
  ///
  /// One definition on each side, and the server's is the one that bills. Shown
  /// here so an admin about to approve somebody can see it costs money before
  /// they tap, rather than discovering it on an invoice.
  bool get occupiesSeat => this == DriverStatus.approved;

  bool get isAssignable => this == DriverStatus.approved;

  bool get isTerminal => this == DriverStatus.offboarded;
}

/// The transitions the server's state machine allows.
///
/// Mirrored so a menu offers only the moves that will succeed. Note the
/// absence of `pendingApproval → …` straight to nothing else and, more
/// importantly, that there is **no edge from `invited` to `approved`**:
/// approval is a decision about documents somebody submitted, and an operator
/// that can approve an empty file has an onboarding control that does nothing.
const Map<DriverStatus, List<DriverStatus>> allowedDriverTransitions = {
  DriverStatus.invited: [DriverStatus.pendingApproval, DriverStatus.offboarded],
  DriverStatus.pendingApproval: [
    DriverStatus.approved,
    DriverStatus.suspended,
    DriverStatus.offboarded,
  ],
  DriverStatus.approved: [DriverStatus.suspended, DriverStatus.offboarded],
  DriverStatus.suspended: [DriverStatus.approved, DriverStatus.offboarded],
  DriverStatus.offboarded: [],
};

List<DriverStatus> nextStatusesFor(DriverStatus from) =>
    allowedDriverTransitions[from] ?? const [];

bool canTransitionDriver(DriverStatus from, DriverStatus to) =>
    nextStatusesFor(from).contains(to);

/// Whether moving to [to] requires the dispatcher to say why.
///
/// Suspension and offboarding both end somebody's ability to earn, and a
/// record of one with no reason attached is unanswerable three months later
/// when they ask. The server accepts a reason on any transition; the console
/// insists on one for these two.
bool transitionNeedsReason(DriverStatus to) =>
    to == DriverStatus.suspended || to == DriverStatus.offboarded;

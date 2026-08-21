// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';

/// RideStatus, as the API spells it.
enum RideStatus {
  draft('draft'),
  requested('requested'),
  awaitingAssignment('awaitingAssignment'),
  assigned('assigned'),
  driverAccepted('driverAccepted'),
  driverEnRoute('driverEnRoute'),
  driverArrived('driverArrived'),
  passengerOnboard('passengerOnboard'),
  inProgress('inProgress'),
  arrivedAtDestination('arrivedAtDestination'),
  completed('completed'),
  canceled('canceled'),
  noShow('noShow'),
  reassignmentRequired('reassignmentRequired');

  const RideStatus(this.wireName);

  /// The exact string the API uses. Kept separate from the Dart identifier so a
  /// value like "in_progress" stays valid Dart without changing the wire
  /// format.
  final String wireName;

  /// Unknown values throw rather than falling back. A value this client has
  /// never heard of means the server is ahead of the app, and silently mapping
  /// it to a default would render a ride in the wrong state.
  static RideStatus fromJson(String value) => values.firstWhere(
    (e) => e.wireName == value,
    orElse: () => throw CareBridgeUnknownEnumValue('RideStatus', value),
  );
}

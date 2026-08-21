// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';

/// Checking in is deliberately **not** inferred from the ride completing. A
/// completed ride says a car reached an address; a check-in says somebody
/// inside the building saw the patient, and the gap between the two is the
/// case this product exists for.
enum ExpectedArrivalDtoStage {
  expected('expected'),
  checkedIn('checkedIn'),
  readyForReturn('readyForReturn'),
  returning('returning'),
  finished('finished');

  const ExpectedArrivalDtoStage(this.wireName);

  /// The exact string the API uses. Kept separate from the Dart identifier so a
  /// value like "in_progress" stays valid Dart without changing the wire
  /// format.
  final String wireName;

  /// Unknown values throw rather than falling back. A value this client has
  /// never heard of means the server is ahead of the app, and silently mapping
  /// it to a default would render a ride in the wrong state.
  static ExpectedArrivalDtoStage fromJson(String value) => values.firstWhere(
    (e) => e.wireName == value,
    orElse: () =>
        throw CareBridgeUnknownEnumValue('ExpectedArrivalDtoStage', value),
  );
}

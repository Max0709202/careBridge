// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';

/// Which install this token belongs to. The driver app is a separate binary
/// (D4) with a separate token set — a family notification arriving on a
/// driver’s phone would be both confusing and a disclosure.
enum RegisterDeviceDtoAppTarget {
  family('family'),
  driver('driver'),
  ops('ops');

  const RegisterDeviceDtoAppTarget(this.wireName);

  /// The exact string the API uses. Kept separate from the Dart identifier so a
  /// value like "in_progress" stays valid Dart without changing the wire
  /// format.
  final String wireName;

  /// Unknown values throw rather than falling back. A value this client has
  /// never heard of means the server is ahead of the app, and silently mapping
  /// it to a default would render a ride in the wrong state.
  static RegisterDeviceDtoAppTarget fromJson(String value) => values.firstWhere(
    (e) => e.wireName == value,
    orElse: () =>
        throw CareBridgeUnknownEnumValue('RegisterDeviceDtoAppTarget', value),
  );
}

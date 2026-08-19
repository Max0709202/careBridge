// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// SetDriverStatusDto, from the CareBridge API.
class SetDriverStatusDto {
  const SetDriverStatusDto({required this.to, this.reason});

  /// Drives the lifecycle state machine in src/domain/driver-status.ts.
  /// Crossing into or out of `approved` is what moves a billable seat.
  final DriverStatus to;

  final String? reason;

  factory SetDriverStatusDto.fromJson(Map<String, dynamic> json) =>
      SetDriverStatusDto(
        to: DriverStatus.fromJson(json['to'] as String),
        reason: json['reason'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'to': to.wireName,
    if (reason != null) 'reason': reason,
  };
}

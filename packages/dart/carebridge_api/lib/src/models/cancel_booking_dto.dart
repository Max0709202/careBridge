// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// CancelBookingDto, from the CareBridge API.
class CancelBookingDto {
  const CancelBookingDto({required this.reason});

  /// Required. A cancellation with no reason is a dispute nobody can settle,
  /// and the caregiver has kept the time free.
  final String reason;

  factory CancelBookingDto.fromJson(Map<String, dynamic> json) =>
      CancelBookingDto(reason: json['reason'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'reason': reason};
}

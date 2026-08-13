// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// CancelAppointmentDto, from the CareBridge API.
class CancelAppointmentDto {
  const CancelAppointmentDto({this.reason});

  final String? reason;

  factory CancelAppointmentDto.fromJson(Map<String, dynamic> json) =>
      CancelAppointmentDto(reason: json['reason'] as String?);

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (reason != null) 'reason': reason,
  };
}

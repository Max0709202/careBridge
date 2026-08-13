// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// RescheduleAppointmentDto, from the CareBridge API.
class RescheduleAppointmentDto {
  const RescheduleAppointmentDto({required this.startsAt});

  final DateTime startsAt;

  factory RescheduleAppointmentDto.fromJson(Map<String, dynamic> json) =>
      RescheduleAppointmentDto(
        startsAt: DateTime.parse(json['startsAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'startsAt': startsAt.toIso8601String(),
  };
}

// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// CreateBookingDto, from the CareBridge API.
class CreateBookingDto {
  const CreateBookingDto({
    required this.caregiverId,
    required this.patientId,
    required this.startsAt,
    required this.endsAt,
  });

  final String caregiverId;

  final String patientId;

  final DateTime startsAt;

  final DateTime endsAt;

  factory CreateBookingDto.fromJson(Map<String, dynamic> json) =>
      CreateBookingDto(
        caregiverId: json['caregiverId'] as String,
        patientId: json['patientId'] as String,
        startsAt: DateTime.parse(json['startsAt'] as String),
        endsAt: DateTime.parse(json['endsAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'caregiverId': caregiverId,
    'patientId': patientId,
    'startsAt': startsAt.toIso8601String(),
    'endsAt': endsAt.toIso8601String(),
  };
}

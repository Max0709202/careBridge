// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// AvailabilityWindowDto, from the CareBridge API.
class AvailabilityWindowDto {
  const AvailabilityWindowDto({
    required this.weekday,
    required this.startMinute,
    required this.endMinute,
    required this.timeZone,
  });

  /// 1 = Monday, 7 = Sunday (ISO).
  final int weekday;

  final int startMinute;

  final int endMinute;

  final String timeZone;

  factory AvailabilityWindowDto.fromJson(Map<String, dynamic> json) =>
      AvailabilityWindowDto(
        weekday: json['weekday'] as int,
        startMinute: json['startMinute'] as int,
        endMinute: json['endMinute'] as int,
        timeZone: json['timeZone'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'weekday': weekday,
    'startMinute': startMinute,
    'endMinute': endMinute,
    'timeZone': timeZone,
  };
}

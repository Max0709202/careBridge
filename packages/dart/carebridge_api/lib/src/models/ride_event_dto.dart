// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// RideEventDto, from the CareBridge API.
class RideEventDto {
  const RideEventDto({
    required this.at,
    required this.title,
    this.detail,
    required this.isException,
  });

  final DateTime at;

  final String title;

  final String? detail;

  final bool isException;

  factory RideEventDto.fromJson(Map<String, dynamic> json) => RideEventDto(
    at: DateTime.parse(json['at'] as String),
    title: json['title'] as String,
    detail: json['detail'] as String?,
    isException: json['isException'] as bool,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'at': at.toIso8601String(),
    'title': title,
    if (detail != null) 'detail': detail,
    'isException': isException,
  };
}

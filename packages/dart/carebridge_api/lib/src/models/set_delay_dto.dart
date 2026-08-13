// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// SetDelayDto, from the CareBridge API.
class SetDelayDto {
  const SetDelayDto({required this.delayed, this.reason});

  final bool delayed;

  final String? reason;

  factory SetDelayDto.fromJson(Map<String, dynamic> json) => SetDelayDto(
    delayed: json['delayed'] as bool,
    reason: json['reason'] as String?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'delayed': delayed,
    if (reason != null) 'reason': reason,
  };
}

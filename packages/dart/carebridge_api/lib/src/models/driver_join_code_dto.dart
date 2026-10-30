// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// DriverJoinCodeDto, from the CareBridge API.
class DriverJoinCodeDto {
  const DriverJoinCodeDto({required this.code});

  /// What a driver types into the driver app to apply.
  final String code;

  factory DriverJoinCodeDto.fromJson(Map<String, dynamic> json) =>
      DriverJoinCodeDto(code: json['code'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'code': code};
}

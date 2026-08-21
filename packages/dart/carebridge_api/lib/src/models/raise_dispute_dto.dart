// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// RaiseDisputeDto, from the CareBridge API.
class RaiseDisputeDto {
  const RaiseDisputeDto({required this.reason});

  final String reason;

  factory RaiseDisputeDto.fromJson(Map<String, dynamic> json) =>
      RaiseDisputeDto(reason: json['reason'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'reason': reason};
}

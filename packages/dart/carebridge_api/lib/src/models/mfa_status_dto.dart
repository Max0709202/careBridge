// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// MfaStatusDto, from the CareBridge API.
class MfaStatusDto {
  const MfaStatusDto({
    required this.enrolled,
    this.confirmedAt,
    required this.recoveryCodesRemaining,
  });

  final bool enrolled;

  final DateTime? confirmedAt;

  final int recoveryCodesRemaining;

  factory MfaStatusDto.fromJson(Map<String, dynamic> json) => MfaStatusDto(
    enrolled: json['enrolled'] as bool,
    confirmedAt: json['confirmedAt'] == null
        ? null
        : DateTime.parse(json['confirmedAt'] as String),
    recoveryCodesRemaining: json['recoveryCodesRemaining'] as int,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'enrolled': enrolled,
    if (confirmedAt != null) 'confirmedAt': confirmedAt?.toIso8601String(),
    'recoveryCodesRemaining': recoveryCodesRemaining,
  };
}

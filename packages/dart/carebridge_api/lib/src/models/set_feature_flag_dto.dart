// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// SetFeatureFlagDto, from the CareBridge API.
class SetFeatureFlagDto {
  const SetFeatureFlagDto({
    required this.description,
    required this.enabled,
    required this.rolloutPercent,
    this.confirmNarrowing,
  });

  final String description;

  final bool enabled;

  final double rolloutPercent;

  /// Required when narrowing a rollout. Taking a feature away from people who
  /// already had it reads to them as a bug, so it has to be said out loud
  /// rather than typed by accident.
  final bool? confirmNarrowing;

  factory SetFeatureFlagDto.fromJson(Map<String, dynamic> json) =>
      SetFeatureFlagDto(
        description: json['description'] as String,
        enabled: json['enabled'] as bool,
        rolloutPercent: (json['rolloutPercent'] as num).toDouble(),
        confirmNarrowing: json['confirmNarrowing'] as bool?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'description': description,
    'enabled': enabled,
    'rolloutPercent': rolloutPercent,
    if (confirmNarrowing != null) 'confirmNarrowing': confirmNarrowing,
  };
}

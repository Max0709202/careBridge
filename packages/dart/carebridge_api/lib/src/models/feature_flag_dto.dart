// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// FeatureFlagDto, from the CareBridge API.
class FeatureFlagDto {
  const FeatureFlagDto({
    required this.key,
    required this.description,
    required this.enabled,
    required this.rolloutPercent,
    required this.updatedAt,
    this.updatedByName,
  });

  final String key;

  final String description;

  final bool enabled;

  /// Applied to a stable hash of the subject, so a given user is on the same
  /// side of the line on every request. A flag that flipped per request would
  /// be worse than one that is simply off.
  final int rolloutPercent;

  final DateTime updatedAt;

  final String? updatedByName;

  factory FeatureFlagDto.fromJson(Map<String, dynamic> json) => FeatureFlagDto(
    key: json['key'] as String,
    description: json['description'] as String,
    enabled: json['enabled'] as bool,
    rolloutPercent: json['rolloutPercent'] as int,
    updatedAt: DateTime.parse(json['updatedAt'] as String),
    updatedByName: json['updatedByName'] as String?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'key': key,
    'description': description,
    'enabled': enabled,
    'rolloutPercent': rolloutPercent,
    'updatedAt': updatedAt.toIso8601String(),
    if (updatedByName != null) 'updatedByName': updatedByName,
  };
}

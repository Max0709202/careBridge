// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// SessionSummaryDto, from the CareBridge API.
class SessionSummaryDto {
  const SessionSummaryDto({
    required this.id,
    required this.deviceLabel,
    required this.isCurrent,
    required this.createdAt,
    required this.lastUsedAt,
    required this.expiresAt,
  });

  /// The refresh-token family id. Stable for the life of one sign-in, which is
  /// what makes it the thing a person recognises and revokes — individual
  /// tokens rotate every few minutes.
  final String id;

  final String deviceLabel;

  final bool isCurrent;

  final DateTime createdAt;

  final DateTime lastUsedAt;

  final DateTime expiresAt;

  factory SessionSummaryDto.fromJson(Map<String, dynamic> json) =>
      SessionSummaryDto(
        id: json['id'] as String,
        deviceLabel: json['deviceLabel'] as String,
        isCurrent: json['isCurrent'] as bool,
        createdAt: DateTime.parse(json['createdAt'] as String),
        lastUsedAt: DateTime.parse(json['lastUsedAt'] as String),
        expiresAt: DateTime.parse(json['expiresAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'deviceLabel': deviceLabel,
    'isCurrent': isCurrent,
    'createdAt': createdAt.toIso8601String(),
    'lastUsedAt': lastUsedAt.toIso8601String(),
    'expiresAt': expiresAt.toIso8601String(),
  };
}

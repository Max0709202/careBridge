// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// StatusChangeDto, from the CareBridge API.
class StatusChangeDto {
  const StatusChangeDto({
    required this.at,
    required this.from,
    required this.to,
    required this.actor,
    this.reason,
  });

  final DateTime at;

  final String from;

  final String to;

  final String actor;

  final String? reason;

  factory StatusChangeDto.fromJson(Map<String, dynamic> json) =>
      StatusChangeDto(
        at: DateTime.parse(json['at'] as String),
        from: json['from'] as String,
        to: json['to'] as String,
        actor: json['actor'] as String,
        reason: json['reason'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'at': at.toIso8601String(),
    'from': from,
    'to': to,
    'actor': actor,
    if (reason != null) 'reason': reason,
  };
}

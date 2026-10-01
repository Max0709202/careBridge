// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// CallCalleeDto, from the CareBridge API.
class CallCalleeDto {
  const CallCalleeDto({
    required this.kind,
    required this.id,
  });

  final CallPartyKind kind;

  /// From the call target.
  final String id;

  factory CallCalleeDto.fromJson(Map<String, dynamic> json) => CallCalleeDto(
        kind: CallPartyKind.fromJson(json['kind'] as String),
        id: json['id'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'kind': kind.wireName,
        'id': id,
      };
}

// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// CallTargetDto, from the CareBridge API.
class CallTargetDto {
  const CallTargetDto({
    required this.kind,
    required this.id,
    required this.label,
    required this.available,
    this.unavailableReason,
  });

  final CallPartyKind kind;

  /// Patient, user, driver or organisation id, as `kind` says.
  final String id;

  /// "Eleanor (patient)", "Sarah (daughter)", "Meridian Transit dispatch".
  final String label;

  final bool available;

  /// Why not, in words to show: no number on file, calling not set up.
  final String? unavailableReason;

  factory CallTargetDto.fromJson(Map<String, dynamic> json) => CallTargetDto(
        kind: CallPartyKind.fromJson(json['kind'] as String),
        id: json['id'] as String,
        label: json['label'] as String,
        available: json['available'] as bool,
        unavailableReason: json['unavailableReason'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'kind': kind.wireName,
        'id': id,
        'label': label,
        'available': available,
        if (unavailableReason != null) 'unavailableReason': unavailableReason,
      };
}

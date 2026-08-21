// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ResolveDisputeDto, from the CareBridge API.
class ResolveDisputeDto {
  const ResolveDisputeDto({required this.outcome, required this.note});

  final ResolveDisputeDtoOutcome outcome;

  /// Required. A decision with no reasoning is one nobody can defend when the
  /// same question is asked again.
  final String note;

  factory ResolveDisputeDto.fromJson(Map<String, dynamic> json) =>
      ResolveDisputeDto(
        outcome: ResolveDisputeDtoOutcome.fromJson(json['outcome'] as String),
        note: json['note'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'outcome': outcome.wireName,
    'note': note,
  };
}

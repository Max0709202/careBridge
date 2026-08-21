// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ReviewDocumentDto, from the CareBridge API.
class ReviewDocumentDto {
  const ReviewDocumentDto({required this.decision, this.note});

  final ReviewDocumentDtoDecision decision;

  /// Required when rejecting. “Rejected” with no reason is a driver who
  /// re-uploads the same unreadable photograph three times.
  final String? note;

  factory ReviewDocumentDto.fromJson(Map<String, dynamic> json) =>
      ReviewDocumentDto(
        decision: ReviewDocumentDtoDecision.fromJson(
          json['decision'] as String,
        ),
        note: json['note'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'decision': decision.wireName,
    if (note != null) 'note': note,
  };
}

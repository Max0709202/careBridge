// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// ReportLocationBatchDto, from the CareBridge API.
class ReportLocationBatchDto {
  const ReportLocationBatchDto({required this.points});

  /// Readings in any order; the server sorts them. Two hundred and forty is
  /// twenty minutes of the fastest cadence, which is longer than any dead zone
  /// this product expects to survive — a queue longer than that is flushed in
  /// several batches rather than being silently truncated.
  final List<ReportLocationDto> points;

  factory ReportLocationBatchDto.fromJson(Map<String, dynamic> json) =>
      ReportLocationBatchDto(
        points: (json['points'] as List<dynamic>)
            .map((e) => ReportLocationDto.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'points': points.map((e) => e.toJson()).toList(),
  };
}

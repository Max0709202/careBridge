// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// LocationBatchResultDto, from the CareBridge API.
class LocationBatchResultDto {
  const LocationBatchResultDto({
    required this.stored,
    required this.ignored,
    required this.positionUpdated,
  });

  /// Readings written to the journey record.
  final int stored;

  /// Readings the server declined to keep — stamped in the future, or already
  /// held from an earlier flush of the same queue.
  final int ignored;

  /// Whether the batch moved the position the family sees. False for a batch
  /// that drained late: its readings are history, and history must not
  /// overwrite a fresher position.
  final bool positionUpdated;

  factory LocationBatchResultDto.fromJson(Map<String, dynamic> json) =>
      LocationBatchResultDto(
        stored: json['stored'] as int,
        ignored: json['ignored'] as int,
        positionUpdated: json['positionUpdated'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'stored': stored,
    'ignored': ignored,
    'positionUpdated': positionUpdated,
  };
}

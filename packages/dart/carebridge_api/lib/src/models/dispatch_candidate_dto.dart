// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// DispatchCandidateDto, from the CareBridge API.
class DispatchCandidateDto {
  const DispatchCandidateDto({
    required this.driverId,
    required this.displayName,
    required this.eligible,
    required this.reasons,
  });

  final String driverId;

  final String displayName;

  final bool eligible;

  /// Every reason this driver cannot take the trip, not just the first —
  /// "nobody is on shift" and "nobody has an accessible vehicle" need different
  /// phone calls.
  final List<String> reasons;

  factory DispatchCandidateDto.fromJson(Map<String, dynamic> json) =>
      DispatchCandidateDto(
        driverId: json['driverId'] as String,
        displayName: json['displayName'] as String,
        eligible: json['eligible'] as bool,
        reasons: (json['reasons'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'driverId': driverId,
    'displayName': displayName,
    'eligible': eligible,
    'reasons': reasons.map((e) => e).toList(),
  };
}

// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// UpdatePreferencesDto, from the CareBridge API.
class UpdatePreferencesDto {
  const UpdatePreferencesDto({this.simplifiedMode, this.selectedPatientId});

  /// Larger type, higher contrast, fewer controls.
  final bool? simplifiedMode;

  /// Persisted per account so a refresh or a new device lands the user back
  /// where they were. A selection whose grant has since been revoked is dropped
  /// on read rather than stored forever.
  final String? selectedPatientId;

  factory UpdatePreferencesDto.fromJson(Map<String, dynamic> json) =>
      UpdatePreferencesDto(
        simplifiedMode: json['simplifiedMode'] as bool?,
        selectedPatientId: json['selectedPatientId'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (simplifiedMode != null) 'simplifiedMode': simplifiedMode,
    if (selectedPatientId != null) 'selectedPatientId': selectedPatientId,
  };
}

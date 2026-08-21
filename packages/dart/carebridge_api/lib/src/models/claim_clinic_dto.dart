// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// ClaimClinicDto, from the CareBridge API.
class ClaimClinicDto {
  const ClaimClinicDto({this.note});

  /// Why this network is claiming this site. Recorded in the audit log —
  /// claiming a clinic grants sight of every appointment booked there.
  final String? note;

  factory ClaimClinicDto.fromJson(Map<String, dynamic> json) =>
      ClaimClinicDto(note: json['note'] as String?);

  Map<String, dynamic> toJson() => <String, dynamic>{
    if (note != null) 'note': note,
  };
}

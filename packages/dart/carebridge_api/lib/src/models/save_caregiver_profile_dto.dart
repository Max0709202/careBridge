// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// SaveCaregiverProfileDto, from the CareBridge API.
class SaveCaregiverProfileDto {
  const SaveCaregiverProfileDto({
    required this.displayName,
    required this.bio,
    required this.yearsExperience,
    required this.languages,
    required this.hourlyRateCents,
    required this.serviceAreaCity,
    required this.serviceAreaState,
  });

  final String displayName;

  final String bio;

  final double yearsExperience;

  final List<String> languages;

  final double hourlyRateCents;

  final String serviceAreaCity;

  final String serviceAreaState;

  factory SaveCaregiverProfileDto.fromJson(Map<String, dynamic> json) =>
      SaveCaregiverProfileDto(
        displayName: json['displayName'] as String,
        bio: json['bio'] as String,
        yearsExperience: (json['yearsExperience'] as num).toDouble(),
        languages: (json['languages'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
        hourlyRateCents: (json['hourlyRateCents'] as num).toDouble(),
        serviceAreaCity: json['serviceAreaCity'] as String,
        serviceAreaState: json['serviceAreaState'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'displayName': displayName,
    'bio': bio,
    'yearsExperience': yearsExperience,
    'languages': languages.map((e) => e).toList(),
    'hourlyRateCents': hourlyRateCents,
    'serviceAreaCity': serviceAreaCity,
    'serviceAreaState': serviceAreaState,
  };
}

// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// CaregiverCardDto, from the CareBridge API.
class CaregiverCardDto {
  const CaregiverCardDto({
    required this.id,
    required this.displayName,
    required this.bio,
    required this.yearsExperience,
    required this.languages,
    required this.hourlyRateCents,
    required this.serviceArea,
    required this.status,
    this.rating,
    this.rawAverage,
    required this.reviewCount,
    required this.verificationStatement,
    required this.identityConfirmed,
    required this.backgroundCheckRun,
    this.backgroundCheckAgeDays,
  });

  final String id;

  /// First name and last initial. Never a full legal name.
  final String displayName;

  final String bio;

  final int yearsExperience;

  final List<String> languages;

  final int hourlyRateCents;

  final String serviceArea;

  final CaregiverStatus status;

  /// Pulled towards a prior, so one bad review cannot halve a career. Null
  /// until there are enough reviews to say anything — a number from one opinion
  /// looks exactly like a number from a hundred.
  final double? rating;

  final double? rawAverage;

  final int reviewCount;

  /// What was checked and when, in a sentence. Deliberately not a badge: this
  /// platform does not assert that anybody is safe, and a tick would say
  /// exactly that.
  final String verificationStatement;

  final bool identityConfirmed;

  final bool backgroundCheckRun;

  final int? backgroundCheckAgeDays;

  factory CaregiverCardDto.fromJson(Map<String, dynamic> json) =>
      CaregiverCardDto(
        id: json['id'] as String,
        displayName: json['displayName'] as String,
        bio: json['bio'] as String,
        yearsExperience: json['yearsExperience'] as int,
        languages: (json['languages'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
        hourlyRateCents: json['hourlyRateCents'] as int,
        serviceArea: json['serviceArea'] as String,
        status: CaregiverStatus.fromJson(json['status'] as String),
        rating: json['rating'] == null
            ? null
            : (json['rating'] as num).toDouble(),
        rawAverage: json['rawAverage'] == null
            ? null
            : (json['rawAverage'] as num).toDouble(),
        reviewCount: json['reviewCount'] as int,
        verificationStatement: json['verificationStatement'] as String,
        identityConfirmed: json['identityConfirmed'] as bool,
        backgroundCheckRun: json['backgroundCheckRun'] as bool,
        backgroundCheckAgeDays: json['backgroundCheckAgeDays'] as int?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'displayName': displayName,
    'bio': bio,
    'yearsExperience': yearsExperience,
    'languages': languages.map((e) => e).toList(),
    'hourlyRateCents': hourlyRateCents,
    'serviceArea': serviceArea,
    'status': status.wireName,
    if (rating != null) 'rating': rating,
    if (rawAverage != null) 'rawAverage': rawAverage,
    'reviewCount': reviewCount,
    'verificationStatement': verificationStatement,
    'identityConfirmed': identityConfirmed,
    'backgroundCheckRun': backgroundCheckRun,
    if (backgroundCheckAgeDays != null)
      'backgroundCheckAgeDays': backgroundCheckAgeDays,
  };
}

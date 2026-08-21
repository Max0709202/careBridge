// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// DriverDocumentsDto, from the CareBridge API.
class DriverDocumentsDto {
  const DriverDocumentsDto({
    required this.compliant,
    required this.missing,
    required this.expiringSoon,
    required this.documents,
  });

  /// Whether the paperwork permits the operator approving this driver.
  final bool compliant;

  /// Every required document still wanted, not just the first.
  final List<String> missing;

  final List<String> expiringSoon;

  /// Including the rejection note. Being told “you cannot drive” without being
  /// told which document and why is how somebody re-uploads the same unreadable
  /// photograph three times and then telephones.
  final List<DriverDocumentDto> documents;

  factory DriverDocumentsDto.fromJson(Map<String, dynamic> json) =>
      DriverDocumentsDto(
        compliant: json['compliant'] as bool,
        missing: (json['missing'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
        expiringSoon: (json['expiringSoon'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
        documents: (json['documents'] as List<dynamic>)
            .map((e) => DriverDocumentDto.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'compliant': compliant,
    'missing': missing.map((e) => e).toList(),
    'expiringSoon': expiringSoon.map((e) => e).toList(),
    'documents': documents.map((e) => e.toJson()).toList(),
  };
}

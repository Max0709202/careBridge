// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// DriverComplianceDto, from the CareBridge API.
class DriverComplianceDto {
  const DriverComplianceDto({
    required this.compliant,
    required this.missing,
    required this.expiringSoon,
    required this.documents,
  });

  /// Whether the paperwork permits approving this driver. Re-checked inside the
  /// approval transaction — the console greys the button out, but a check only
  /// the screen performs is one a second tab can race past.
  final bool compliant;

  /// Every required document still missing, not just the first. Deliberately
  /// excludes the background check: a platform lookup is not what makes
  /// somebody safe, and treating it as such would be a claim this product does
  /// not make.
  final List<String> missing;

  /// Valid today, lapsing within thirty days.
  final List<String> expiringSoon;

  final List<DriverDocumentDto> documents;

  factory DriverComplianceDto.fromJson(Map<String, dynamic> json) =>
      DriverComplianceDto(
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

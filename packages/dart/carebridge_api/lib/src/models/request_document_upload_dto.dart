// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// RequestDocumentUploadDto, from the CareBridge API.
class RequestDocumentUploadDto {
  const RequestDocumentUploadDto({
    required this.kind,
    required this.contentType,
    this.expiresAt,
  });

  /// A short list of legal requirements and nothing else. A server that stored
  /// whatever arrived would be an operator holding a driver’s passport because
  /// the form allowed one.
  final DriverDocumentKind kind;

  /// Signed into the upload URL, so it is a bound rather than a request: a slot
  /// authorised for a JPEG cannot be filled with anything else.
  final String contentType;

  /// The date printed on the document, where it has one. Not a retention
  /// deadline — this is what makes an insurance certificate stop counting the
  /// day it lapses.
  final DateTime? expiresAt;

  factory RequestDocumentUploadDto.fromJson(Map<String, dynamic> json) =>
      RequestDocumentUploadDto(
        kind: DriverDocumentKind.fromJson(json['kind'] as String),
        contentType: json['contentType'] as String,
        expiresAt: json['expiresAt'] == null
            ? null
            : DateTime.parse(json['expiresAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'kind': kind.wireName,
    'contentType': contentType,
    if (expiresAt != null) 'expiresAt': expiresAt?.toIso8601String(),
  };
}

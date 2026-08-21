// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// DriverDocumentDto, from the CareBridge API.
class DriverDocumentDto {
  const DriverDocumentDto({
    required this.id,
    required this.kind,
    required this.status,
    required this.contentType,
    this.byteSize,
    this.expiresAt,
    this.submittedAt,
    this.reviewedAt,
    this.reviewNote,
    required this.superseded,
  });

  final String id;

  final DriverDocumentKind kind;

  final DriverDocumentStatus status;

  final String contentType;

  final int? byteSize;

  /// The date printed on the document. An approved certificate past this date
  /// stops counting immediately, rather than when a sweep next notices.
  final DateTime? expiresAt;

  final DateTime? submittedAt;

  final DateTime? reviewedAt;

  final String? reviewNote;

  /// Replaced by a newer upload. Kept rather than deleted, so “which
  /// certificate was in force in March” stays answerable.
  final bool superseded;

  factory DriverDocumentDto.fromJson(Map<String, dynamic> json) =>
      DriverDocumentDto(
        id: json['id'] as String,
        kind: DriverDocumentKind.fromJson(json['kind'] as String),
        status: DriverDocumentStatus.fromJson(json['status'] as String),
        contentType: json['contentType'] as String,
        byteSize: json['byteSize'] as int?,
        expiresAt: json['expiresAt'] == null
            ? null
            : DateTime.parse(json['expiresAt'] as String),
        submittedAt: json['submittedAt'] == null
            ? null
            : DateTime.parse(json['submittedAt'] as String),
        reviewedAt: json['reviewedAt'] == null
            ? null
            : DateTime.parse(json['reviewedAt'] as String),
        reviewNote: json['reviewNote'] as String?,
        superseded: json['superseded'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'kind': kind.wireName,
    'status': status.wireName,
    'contentType': contentType,
    if (byteSize != null) 'byteSize': byteSize,
    if (expiresAt != null) 'expiresAt': expiresAt?.toIso8601String(),
    if (submittedAt != null) 'submittedAt': submittedAt?.toIso8601String(),
    if (reviewedAt != null) 'reviewedAt': reviewedAt?.toIso8601String(),
    if (reviewNote != null) 'reviewNote': reviewNote,
    'superseded': superseded,
  };
}

// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// AuditPageDto, from the CareBridge API.
class AuditPageDto {
  const AuditPageDto({required this.entries, this.nextCursor});

  final List<AuditEntryDto> entries;

  /// Pass as `cursor` for the next page. Keyset rather than an offset: an audit
  /// log is appended to constantly, and an offset would skip or repeat rows
  /// between pages.
  final String? nextCursor;

  factory AuditPageDto.fromJson(Map<String, dynamic> json) => AuditPageDto(
    entries: (json['entries'] as List<dynamic>)
        .map((e) => AuditEntryDto.fromJson(e as Map<String, dynamic>))
        .toList(),
    nextCursor: json['nextCursor'] as String?,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'entries': entries.map((e) => e.toJson()).toList(),
    if (nextCursor != null) 'nextCursor': nextCursor,
  };
}

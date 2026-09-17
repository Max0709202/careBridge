// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// DeletionReceiptDto, from the CareBridge API.
class DeletionReceiptDto {
  const DeletionReceiptDto({
    required this.scheduledFor,
    required this.graceDays,
    required this.alreadyPending,
    required this.data,
  });

  final DateTime scheduledFor;

  final int graceDays;

  /// True when a deletion was already pending. The request is idempotent — a
  /// second tap, or a retry after a dropped connection, is not a second
  /// deletion.
  final bool alreadyPending;

  /// Everything CareBridge holds about this account, taken before anything
  /// changed. Returned in the response rather than left behind an endpoint,
  /// because the request signs every device out — so this is the last moment
  /// the account holder can be handed their own data. Credentials are
  /// deliberately excluded.
  final Map<String, dynamic> data;

  factory DeletionReceiptDto.fromJson(Map<String, dynamic> json) =>
      DeletionReceiptDto(
        scheduledFor: DateTime.parse(json['scheduledFor'] as String),
        graceDays: json['graceDays'] as int,
        alreadyPending: json['alreadyPending'] as bool,
        data: json['data'] as Map<String, dynamic>,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'scheduledFor': scheduledFor.toIso8601String(),
    'graceDays': graceDays,
    'alreadyPending': alreadyPending,
    'data': data,
  };
}

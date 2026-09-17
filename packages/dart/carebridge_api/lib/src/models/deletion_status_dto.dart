// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// DeletionStatusDto, from the CareBridge API.
class DeletionStatusDto {
  const DeletionStatusDto({
    required this.blockers,
    required this.blockerMessages,
    required this.graceDays,
  });

  /// Machine-readable reasons deletion is currently refused: `rideInFlight`,
  /// `lastOrganizationOwner`, `unpaidInvoice`. Empty when it would succeed.
  final List<String> blockers;

  /// The same reasons, each with the remedy, as shown to the account holder. A
  /// refusal with no remedy is what makes somebody email support instead —
  /// which is the thing both app stores refuse to accept.
  final List<String> blockerMessages;

  /// The grace period, in days, so the screen can say it.
  final int graceDays;

  factory DeletionStatusDto.fromJson(Map<String, dynamic> json) =>
      DeletionStatusDto(
        blockers: (json['blockers'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
        blockerMessages: (json['blockerMessages'] as List<dynamic>)
            .map((e) => e as String)
            .toList(),
        graceDays: json['graceDays'] as int,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'blockers': blockers.map((e) => e).toList(),
    'blockerMessages': blockerMessages.map((e) => e).toList(),
    'graceDays': graceDays,
  };
}

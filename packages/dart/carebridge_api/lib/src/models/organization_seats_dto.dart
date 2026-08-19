// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../models.dart';

/// OrganizationSeatsDto, from the CareBridge API.
class OrganizationSeatsDto {
  const OrganizationSeatsDto({
    required this.organizationId,
    required this.activeDrivers,
    required this.billedSeats,
    this.renewalQuote,
    required this.ledger,
  });

  final String organizationId;

  /// Drivers on the road right now.
  final int activeDrivers;

  /// Drivers the current subscription is billing for.
  final int billedSeats;

  final SubscriptionQuoteDto? renewalQuote;

  final List<SeatLedgerEntryDto> ledger;

  factory OrganizationSeatsDto.fromJson(Map<String, dynamic> json) =>
      OrganizationSeatsDto(
        organizationId: json['organizationId'] as String,
        activeDrivers: json['activeDrivers'] as int,
        billedSeats: json['billedSeats'] as int,
        renewalQuote: json['renewalQuote'] == null
            ? null
            : SubscriptionQuoteDto.fromJson(
                json['renewalQuote'] as Map<String, dynamic>,
              ),
        ledger: (json['ledger'] as List<dynamic>)
            .map((e) => SeatLedgerEntryDto.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'organizationId': organizationId,
    'activeDrivers': activeDrivers,
    'billedSeats': billedSeats,
    if (renewalQuote != null) 'renewalQuote': renewalQuote?.toJson(),
    'ledger': ledger.map((e) => e.toJson()).toList(),
  };
}
